
create extension if not exists "pgcrypto";


create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null,
  role text not null check (role in ('admin','staff','requester')) default 'requester',
  created_at timestamptz not null default now()
);


create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id, full_name, role)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'full_name', new.email),
    coalesce(new.raw_user_meta_data->>'role', 'requester')
  );
  return new;
end;
$$ language plpgsql security definer;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();


create table if not exists public.facilities (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text,
  location text,
  capacity int,
  status text not null check (status in ('active','maintenance','inactive')) default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);


create table if not exists public.reservations (
  id uuid primary key default gen_random_uuid(),
  facility_id uuid not null references public.facilities(id) on delete cascade,
  requester_id uuid not null references public.profiles(id) on delete cascade,
  purpose text not null,
  start_time timestamptz not null,
  end_time timestamptz not null,
  status text not null check (
    status in ('pending','approved','rejected','scheduled','in_use','completed','cancelled')
  ) default 'pending',
  reviewed_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint chk_time_order check (start_time < end_time) -- BR-B4-02
);


create table if not exists public.service_requests (
  id uuid primary key default gen_random_uuid(),
  facility_id uuid not null references public.facilities(id) on delete cascade,
  staff_id uuid not null references public.profiles(id) on delete cascade,
  description text not null,
  status text not null check (status in ('open','in_progress','resolved')) default 'open',
  created_at timestamptz not null default now()
);


create table if not exists public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid references public.profiles(id),
  action text not null,
  entity_type text not null,
  entity_id uuid,
  details jsonb,
  created_at timestamptz not null default now()
);


create or replace function public.enforce_reservation_rules()
returns trigger as $$
declare
  facility_status text;
  overlap_count int;
begin
  select status into facility_status from public.facilities where id = new.facility_id;


  if facility_status is distinct from 'active' then
    raise exception 'Facility is not active (status: %). Reservation blocked.', facility_status;
  end if;

 
  if new.start_time >= new.end_time then
    raise exception 'Reservation start time must be before end time.';
  end if;


  if TG_OP = 'UPDATE' and old.status = 'completed' then
    raise exception 'Completed reservations cannot be edited.';
  end if;


  if TG_OP = 'UPDATE' and old.status = 'rejected' and new.status = 'scheduled' then
    raise exception 'Rejected reservations cannot become Scheduled.';
  end if;

 
  if new.status in ('approved','scheduled','in_use') then
    select count(*) into overlap_count
    from public.reservations r
    where r.facility_id = new.facility_id
      and r.id <> coalesce(new.id, '00000000-0000-0000-0000-000000000000'::uuid)
      and r.status in ('approved','scheduled','in_use')
      and tstzrange(r.start_time, r.end_time) && tstzrange(new.start_time, new.end_time);

    if overlap_count > 0 then
      raise exception 'Schedule conflict: this facility is already reserved for an overlapping time.';
    end if;
  end if;


  if new.status = 'approved' then
    new.status := 'scheduled';
  end if;

  new.updated_at := now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_enforce_reservation_rules on public.reservations;
create trigger trg_enforce_reservation_rules
  before insert or update on public.reservations
  for each row execute function public.enforce_reservation_rules();


create or replace function public.log_reservation_change()
returns trigger as $$
begin
  if TG_OP = 'INSERT' then
    insert into public.audit_logs (actor_id, action, entity_type, entity_id, details)
    values (new.requester_id, 'reservation_submitted', 'reservation', new.id,
      jsonb_build_object('facility_id', new.facility_id, 'status', new.status));
  elsif TG_OP = 'UPDATE' and old.status is distinct from new.status then
    insert into public.audit_logs (actor_id, action, entity_type, entity_id, details)
    values (coalesce(new.reviewed_by, new.requester_id), 'status_changed', 'reservation', new.id,
      jsonb_build_object('from', old.status, 'to', new.status));
  end if;
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_log_reservation_change on public.reservations;
create trigger trg_log_reservation_change
  after insert or update on public.reservations
  for each row execute function public.log_reservation_change();


create or replace function public.log_facility_change()
returns trigger as $$
begin
  if TG_OP = 'UPDATE' then
    insert into public.audit_logs (action, entity_type, entity_id, details)
    values ('facility_updated', 'facility', new.id,
      jsonb_build_object('old_status', old.status, 'new_status', new.status));
  elsif TG_OP = 'DELETE' then
    insert into public.audit_logs (action, entity_type, entity_id, details)
    values ('facility_deleted', 'facility', old.id, jsonb_build_object('name', old.name));
  end if;
  return coalesce(new, old);
end;
$$ language plpgsql;

drop trigger if exists trg_log_facility_change on public.facilities;
create trigger trg_log_facility_change
  after update or delete on public.facilities
  for each row execute function public.log_facility_change();


alter table public.profiles enable row level security;
alter table public.facilities enable row level security;
alter table public.reservations enable row level security;
alter table public.service_requests enable row level security;
alter table public.audit_logs enable row level security;


create or replace function public.current_role()
returns text as $$
  select role from public.profiles where id = auth.uid();
$$ language sql stable security definer;


create policy "profiles: view own or admin views all"
  on public.profiles for select
  using (id = auth.uid() or public.current_role() = 'admin');

create policy "profiles: user updates own"
  on public.profiles for update
  using (id = auth.uid());


create policy "facilities: everyone (logged in) can view"
  on public.facilities for select
  using (auth.role() = 'authenticated');

create policy "facilities: admin manages"
  on public.facilities for insert
  with check (public.current_role() = 'admin');

create policy "facilities: admin or staff updates"
  on public.facilities for update
  using (public.current_role() in ('admin','staff'));

create policy "facilities: admin deletes"
  on public.facilities for delete
  using (public.current_role() = 'admin');


create policy "reservations: requester views own, staff/admin view all"
  on public.reservations for select
  using (
    requester_id = auth.uid()
    or public.current_role() in ('admin','staff')
  );

create policy "reservations: requester submits own"
  on public.reservations for insert
  with check (requester_id = auth.uid() and public.current_role() = 'requester');


create policy "reservations: update by owner-pending, staff, or admin"
  on public.reservations for update
  using (
    (requester_id = auth.uid() and status = 'pending')
    or public.current_role() in ('admin','staff')
  );

create policy "reservations: owner cancels own pending, admin deletes"
  on public.reservations for delete
  using (
    (requester_id = auth.uid() and status = 'pending')
    or public.current_role() = 'admin'
  );


create policy "service_requests: staff/admin view all, requester none"
  on public.service_requests for select
  using (public.current_role() in ('admin','staff'));

create policy "service_requests: staff creates"
  on public.service_requests for insert
  with check (staff_id = auth.uid() and public.current_role() in ('admin','staff'));

create policy "service_requests: staff/admin updates"
  on public.service_requests for update
  using (public.current_role() in ('admin','staff'));


create policy "audit_logs: admin only"
  on public.audit_logs for select
  using (public.current_role() = 'admin');


insert into public.facilities (name, description, location, capacity, status)
values
  ('Main Auditorium', 'Large event hall with stage and sound system', 'Building A, Ground Floor', 300, 'active'),
  ('Computer Lab 1', 'CCIS computer laboratory', 'Building B, 2nd Floor', 40, 'active'),
  ('Conference Room', 'Small meeting room', 'Building A, 3rd Floor', 15, 'maintenance')
on conflict do nothing;
