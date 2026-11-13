-- The store's schema. Money is in cents (bigint); every time is timestamptz.

create extension if not exists unaccent;
create extension if not exists pg_trgm;

-- unaccent() is not immutable (it reads a dictionary), so it cannot go into an index or a generated
-- column; this wrapper fixes the dictionary, which makes it safe to declare immutable
create function f_unaccent(text) returns text
  language sql immutable parallel safe strict
  as $$ select public.unaccent('public.unaccent'::regdictionary, $1) $$;

create table settings (
  key text primary key,
  value text not null
);

create table categories (
  id bigserial primary key,
  parent_id bigint references categories(id) on delete restrict,
  name text not null,
  slug text not null unique,
  description text not null default '',
  position int not null default 0
);
create index categories_parent on categories(parent_id, position);

create table products (
  id bigserial primary key,
  category_id bigint not null references categories(id) on delete restrict,
  name text not null,
  slug text not null unique,
  description text not null default '',
  price_cents bigint not null check (price_cents > 0),
  sale_cents bigint check (sale_cents > 0),
  stock int not null default 0 check (stock >= 0),
  active boolean not null default true,
  hue int not null default 20,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  search tsvector generated always as (
    setweight(to_tsvector('portuguese', f_unaccent(name)), 'A') ||
    setweight(to_tsvector('portuguese', f_unaccent(description)), 'B')
  ) stored
);
create index products_search on products using gin(search);
create index products_name_trgm on products using gin(f_unaccent(lower(name)) gin_trgm_ops);
create index products_category on products(category_id) where active;
create index products_price on products((coalesce(sale_cents, price_cents))) where active;

create table sections (
  id bigserial primary key,
  title text not null,
  subtitle text not null default '',
  position int not null default 0,
  active boolean not null default true
);

create table section_products (
  section_id bigint not null references sections(id) on delete cascade,
  product_id bigint not null references products(id) on delete cascade,
  position int not null default 0,
  primary key (section_id, product_id)
);

create table customers (
  id bigserial primary key,
  name text not null,
  email text not null unique,
  phone text not null default '',
  password_hash text not null,
  role text not null default 'customer' check (role in ('customer', 'operator', 'admin')),
  blocked boolean not null default false,
  created_at timestamptz not null default now()
);

create table addresses (
  id bigserial primary key,
  customer_id bigint not null references customers(id) on delete cascade,
  label text not null default '',
  cep text not null,
  street text not null,
  number text not null,
  complement text not null default '',
  district text not null,
  city text not null,
  state text not null
);
create index addresses_customer on addresses(customer_id);

create table carts (
  id bigserial primary key,
  customer_id bigint unique references customers(id) on delete cascade,
  updated_at timestamptz not null default now()
);

create table cart_items (
  cart_id bigint not null references carts(id) on delete cascade,
  product_id bigint not null references products(id) on delete cascade,
  qty int not null check (qty > 0),
  added_at timestamptz not null default now(),
  primary key (cart_id, product_id)
);

-- the cookie carries a random token; the table keeps its SHA-256, so a leaked table opens nothing
create table sessions (
  token_hash text primary key,
  customer_id bigint references customers(id) on delete cascade,
  cart_id bigint references carts(id) on delete set null,
  flash text not null default '',
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);
create index sessions_expires on sessions(expires_at);

create table coupons (
  code text primary key,
  kind text not null check (kind in ('percent', 'fixed')),
  value bigint not null check (value > 0),
  min_cents bigint not null default 0,
  max_uses int,
  used int not null default 0,
  expires_at timestamptz,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

-- shipping by the CEP's range (only digits, 8 of them)
create table shipping_rates (
  id bigserial primary key,
  name text not null,
  cep_from int not null,
  cep_to int not null,
  price_cents bigint not null check (price_cents >= 0),
  days int not null
);

create table orders (
  id bigserial primary key,
  customer_id bigint not null references customers(id),
  status text not null default 'pending' check (status in ('pending', 'paid', 'shipped', 'delivered', 'canceled')),
  subtotal_cents bigint not null,
  shipping_cents bigint not null,
  discount_cents bigint not null default 0,
  total_cents bigint not null,
  coupon_code text,
  ship_name text not null,
  ship_cep text not null,
  ship_street text not null,
  ship_number text not null,
  ship_complement text not null default '',
  ship_district text not null,
  ship_city text not null,
  ship_state text not null,
  shipping_method text not null,
  shipping_days int not null,
  tracking_code text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index orders_customer on orders(customer_id, created_at desc);
create index orders_status on orders(status, created_at desc);
create index orders_created on orders(created_at);

create table order_items (
  order_id bigint not null references orders(id) on delete cascade,
  product_id bigint not null references products(id),
  name text not null,
  unit_cents bigint not null,
  qty int not null check (qty > 0),
  primary key (order_id, product_id)
);
create index order_items_product on order_items(product_id);

create table order_events (
  id bigserial primary key,
  order_id bigint not null references orders(id) on delete cascade,
  status text not null,
  note text not null default '',
  actor_id bigint references customers(id),
  created_at timestamptz not null default now()
);
create index order_events_order on order_events(order_id, id);

create table stock_moves (
  id bigserial primary key,
  product_id bigint not null references products(id) on delete cascade,
  delta int not null,
  reason text not null,
  order_id bigint references orders(id),
  actor_id bigint references customers(id),
  created_at timestamptz not null default now()
);
create index stock_moves_product on stock_moves(product_id, id desc);

create table audit_log (
  id bigserial primary key,
  actor_id bigint references customers(id),
  action text not null,
  entity text not null,
  entity_id text not null default '',
  detail text not null default '',
  created_at timestamptz not null default now()
);
create index audit_log_created on audit_log(created_at desc);
