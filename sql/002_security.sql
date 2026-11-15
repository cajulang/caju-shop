-- Sign-in limits and the housekeeping of what visitors leave behind.

-- every sign-in, sign-up and password change that got to the password check: the limits count
-- them per address (an IPv6 address by its /64) and the failures per e-mail; kept for a day
create table login_attempts (
  id bigserial primary key,
  ip text not null,
  email text not null default '',
  ok boolean not null,
  at timestamptz not null default now()
);
create index login_attempts_ip on login_attempts(ip, at);
create index login_attempts_email on login_attempts(email, at) where not ok;
create index login_attempts_at on login_attempts(at);

-- the visitors' carts that no session points to any more are swept by age
create index carts_guest on carts(updated_at) where customer_id is null;
create index sessions_customer on sessions(customer_id) where customer_id is not null;
create index sessions_cart on sessions(cart_id) where cart_id is not null;
