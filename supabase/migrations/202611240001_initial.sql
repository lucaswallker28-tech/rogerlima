create extension if not exists pgcrypto;

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null default '',
  role text not null default 'student' check (role in ('admin', 'teacher', 'student')),
  created_at timestamptz not null default now()
);

create table public.app_settings (
  key text primary key,
  value jsonb not null
);
insert into public.app_settings (key, value) values ('absence_limit', '2'::jsonb);

create table public.classes (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  level text not null default 'iniciante',
  weekdays integer[] not null default '{}',
  starts_at time not null,
  capacity integer not null check (capacity > 0),
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.students (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid unique references auth.users(id) on delete set null,
  name text not null,
  phone text not null default '',
  enrollment_code text,
  class_id uuid references public.classes(id) on delete set null,
  plan text not null default 'Mensal',
  monthly_fee_cents integer not null default 0 check (monthly_fee_cents >= 0),
  due_day integer not null default 10 check (due_day between 1 and 31),
  status text not null default 'active' check (status in ('active', 'paused', 'inactive')),
  pause_until date,
  notes text not null default '',
  archived_at timestamptz,
  created_at timestamptz not null default now()
);

create or replace function public.set_student_enrollment_code()
returns trigger language plpgsql set search_path = '' as $$
begin
  if nullif(new.enrollment_code, '') is null then
    new.enrollment_code := 'RL-' || upper(substr(replace(new.id::text, '-', ''), 1, 12));
  end if;
  return new;
end;
$$;
create trigger set_student_enrollment_code
  before insert on public.students
  for each row execute procedure public.set_student_enrollment_code();

create table public.class_teachers (
  class_id uuid not null references public.classes(id) on delete cascade,
  teacher_id uuid not null references public.profiles(id) on delete cascade,
  primary key (class_id, teacher_id)
);

create table public.class_students (
  class_id uuid not null references public.classes(id) on delete cascade,
  student_id uuid not null references public.students(id) on delete cascade,
  enrolled_at date not null default current_date,
  active boolean not null default true,
  primary key (class_id, student_id)
);

create or replace function public.sync_student_class_membership()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'UPDATE' and old.class_id is distinct from new.class_id then
    update public.class_students set active = false
    where student_id = old.id and class_id = old.class_id;
  end if;
  if new.class_id is not null then
    insert into public.class_students (class_id, student_id, active)
    values (new.class_id, new.id, new.status = 'active' and new.archived_at is null)
    on conflict (class_id, student_id) do update
      set active = excluded.active;
  end if;
  return new;
end;
$$;

create trigger sync_student_membership
  after insert or update of class_id, status, archived_at on public.students
  for each row execute procedure public.sync_student_class_membership();

create table public.attendance (
  id uuid primary key default gen_random_uuid(),
  class_id uuid not null references public.classes(id) on delete restrict,
  student_id uuid not null references public.students(id) on delete restrict,
  class_date date not null,
  status text not null check (status in ('present', 'absent', 'makeup', 'excused')),
  note text not null default '',
  marked_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (class_id, student_id, class_date)
);

create table public.makeups (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.students(id) on delete restrict,
  class_id uuid not null references public.classes(id) on delete restrict,
  scheduled_for date not null,
  status text not null default 'scheduled' check (status in ('scheduled', 'used', 'cancelled')),
  created_at timestamptz not null default now(),
  unique (student_id, class_id, scheduled_for)
);

create or replace function public.sync_makeup_attendance()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'UPDATE' and old.status = 'makeup' and new.status <> 'makeup' then
    update public.makeups set status = 'scheduled'
    where class_id = old.class_id and student_id = old.student_id
      and scheduled_for = old.class_date and status = 'used';
  end if;
  if new.status = 'makeup' then
    update public.makeups set status = 'used'
    where class_id = new.class_id and student_id = new.student_id
      and scheduled_for = new.class_date and status = 'scheduled';
  end if;
  return new;
end;
$$;

create trigger sync_makeup_attendance
  after insert or update of status on public.attendance
  for each row execute procedure public.sync_makeup_attendance();

create table public.experiments (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  phone text not null default '',
  class_id uuid references public.classes(id) on delete set null,
  scheduled_for timestamptz,
  status text not null default 'scheduled' check (status in ('scheduled', 'attended', 'follow_up', 'converted', 'closed')),
  notes text not null default '',
  converted_student_id uuid references public.students(id) on delete set null,
  created_at timestamptz not null default now()
);

create table public.charges (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.students(id) on delete restrict,
  competence date not null,
  amount_cents integer not null check (amount_cents >= 0),
  due_date date not null,
  created_at timestamptz not null default now(),
  unique (student_id, competence)
);

create table public.charge_adjustments (
  id uuid primary key default gen_random_uuid(),
  charge_id uuid not null references public.charges(id) on delete restrict,
  kind text not null check (kind in ('discount', 'waiver', 'cancel', 'reversal')),
  amount_cents integer not null check (amount_cents > 0),
  note text not null default '',
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

create table public.payments (
  id uuid primary key default gen_random_uuid(),
  charge_id uuid not null references public.charges(id) on delete restrict,
  amount_cents integer not null check (amount_cents > 0),
  paid_at date not null default current_date,
  method text not null default 'manual',
  reversed_at timestamptz,
  note text not null default '',
  received_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id, display_name, role)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'display_name', ''),
    'student'
  );
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

create or replace function public.current_app_role()
returns text language sql stable security definer set search_path = '' as $$
  select role from public.profiles where id = (select auth.uid())
$$;

create or replace function public.student_can_access(target_student uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.students s
    where s.id = target_student and s.auth_user_id = (select auth.uid())
  )
$$;

create or replace function public.teacher_can_access_class(target_class uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select public.current_app_role() = 'teacher' and exists (
    select 1 from public.class_teachers ct
    where ct.class_id = target_class and ct.teacher_id = (select auth.uid())
  )
$$;

create or replace function public.teacher_can_mark_student(target_class uuid, target_student uuid, target_date date)
returns boolean language sql stable security definer set search_path = '' as $$
  select public.teacher_can_access_class(target_class) and exists (
    select 1 from public.class_students cs
    where cs.class_id = target_class and cs.student_id = target_student and cs.active
  ) or public.teacher_can_access_class(target_class) and exists (
    select 1 from public.makeups m
    where m.class_id = target_class and m.student_id = target_student
      and m.scheduled_for = target_date and m.status in ('scheduled', 'used')
  )
$$;

create or replace function public.admin_convert_experiment(target_experiment uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  trial public.experiments%rowtype;
  actual_student uuid;
begin
  if public.current_app_role() is distinct from 'admin' then
    raise exception 'Apenas administradores podem converter experimentais';
  end if;
  select * into trial from public.experiments where id = target_experiment for update;
  if not found then raise exception 'Aula experimental não encontrada'; end if;
  if trial.status = 'converted' then return trial.converted_student_id; end if;
  if trial.status = 'closed' then raise exception 'Uma experimental encerrada não pode ser convertida'; end if;

  if nullif(regexp_replace(trial.phone, '[^0-9]', '', 'g'), '') is not null then
    select s.id into actual_student from public.students s
    where regexp_replace(s.phone, '[^0-9]', '', 'g') = regexp_replace(trial.phone, '[^0-9]', '', 'g')
    order by s.created_at limit 1;
  end if;
  if actual_student is null then
    insert into public.students (name, phone, class_id, plan, monthly_fee_cents, due_day, status)
    values (trial.name, trial.phone, trial.class_id, 'Mensal', 0, 10, 'active')
    returning id into actual_student;
  end if;
  update public.experiments set status = 'converted', converted_student_id = actual_student
  where id = target_experiment;
  return actual_student;
end;
$$;

create or replace function public.guard_teacher_experiment_update()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if public.current_app_role() = 'teacher' then
    if new.name is distinct from old.name
      or new.phone is distinct from old.phone
      or new.class_id is distinct from old.class_id
      or new.scheduled_for is distinct from old.scheduled_for
      or new.notes is distinct from old.notes
      or new.converted_student_id is distinct from old.converted_student_id
      or old.status <> 'scheduled'
      or new.status <> 'attended' then
      raise exception 'Professor pode apenas registrar o comparecimento da experimental';
    end if;
  end if;
  return new;
end;
$$;

create trigger guard_teacher_experiment_update
  before update on public.experiments
  for each row execute procedure public.guard_teacher_experiment_update();

alter table public.profiles enable row level security;
alter table public.app_settings enable row level security;
alter table public.classes enable row level security;
alter table public.students enable row level security;
alter table public.class_teachers enable row level security;
alter table public.class_students enable row level security;
alter table public.attendance enable row level security;
alter table public.makeups enable row level security;
alter table public.experiments enable row level security;
alter table public.charges enable row level security;
alter table public.charge_adjustments enable row level security;
alter table public.payments enable row level security;

create policy "profiles self or admin read" on public.profiles for select
using (id = (select auth.uid()) or public.current_app_role() = 'admin');
create policy "admin manages profiles" on public.profiles for all
using (public.current_app_role() = 'admin') with check (public.current_app_role() = 'admin');
create policy "signed-in users read settings" on public.app_settings for select
using ((select auth.uid()) is not null);
create policy "admin manages settings" on public.app_settings for all
using (public.current_app_role() = 'admin') with check (public.current_app_role() = 'admin');

create policy "classes visible to signed-in users" on public.classes for select
using (
  public.current_app_role() = 'admin'
  or public.teacher_can_access_class(id)
  or exists (
    select 1 from public.class_students cs join public.students s on s.id = cs.student_id
    where cs.class_id = public.classes.id and s.auth_user_id = (select auth.uid())
  )
);
create policy "admin manages classes" on public.classes for all
using (public.current_app_role() = 'admin') with check (public.current_app_role() = 'admin');

create policy "student teacher admin read students" on public.students for select
using (
  public.current_app_role() = 'admin'
  or auth_user_id = (select auth.uid())
  or exists (
    select 1 from public.class_students cs join public.class_teachers ct on ct.class_id = cs.class_id
    where cs.student_id = id and ct.teacher_id = (select auth.uid())
  )
  or exists (
    select 1 from public.makeups m
    where m.student_id = public.students.id and public.teacher_can_access_class(m.class_id)
      and m.status in ('scheduled', 'used')
  )
);
create policy "admin manages students" on public.students for all
using (public.current_app_role() = 'admin') with check (public.current_app_role() = 'admin');

create policy "class teachers read own assignments" on public.class_teachers for select
using (teacher_id = (select auth.uid()) or public.current_app_role() = 'admin');
create policy "admin manages class teachers" on public.class_teachers for all
using (public.current_app_role() = 'admin') with check (public.current_app_role() = 'admin');

create policy "class members and teachers read membership" on public.class_students for select
using (
  public.current_app_role() = 'admin'
  or exists (
    select 1 from public.students s where s.id = student_id and s.auth_user_id = (select auth.uid())
  )
  or public.teacher_can_access_class(class_id)
);
create policy "admin manages class membership" on public.class_students for all
using (public.current_app_role() = 'admin') with check (public.current_app_role() = 'admin');

create policy "attendance visible to owner teacher admin" on public.attendance for select
using (
  public.current_app_role() = 'admin'
  or public.student_can_access(student_id)
  or public.teacher_can_mark_student(class_id, student_id, class_date)
);
create policy "teacher or admin records attendance" on public.attendance for insert
with check (
  public.current_app_role() = 'admin'
  or public.teacher_can_mark_student(class_id, student_id, class_date)
);
create policy "teacher or admin corrects attendance" on public.attendance for update
using (
  public.current_app_role() = 'admin'
  or public.teacher_can_mark_student(class_id, student_id, class_date)
)
with check (
  public.current_app_role() = 'admin'
  or public.teacher_can_mark_student(class_id, student_id, class_date)
);
create policy "admin deletes attendance" on public.attendance for delete
using (public.current_app_role() = 'admin');

create policy "makeups visible to owner teacher admin" on public.makeups for select
using (
  public.current_app_role() = 'admin'
  or public.student_can_access(student_id)
  or public.teacher_can_access_class(class_id)
);
create policy "admin manages makeups" on public.makeups for all
using (public.current_app_role() = 'admin') with check (public.current_app_role() = 'admin');

create policy "experiments visible to admin and assigned teacher" on public.experiments for select
using (
  public.current_app_role() = 'admin'
  or public.teacher_can_access_class(class_id)
);
create policy "admin manages experiments" on public.experiments for all
using (public.current_app_role() = 'admin') with check (public.current_app_role() = 'admin');
create policy "assigned teacher updates experiments" on public.experiments for update
using (public.teacher_can_access_class(class_id))
with check (public.teacher_can_access_class(class_id));

create policy "charges visible to owner admin" on public.charges for select
using (public.current_app_role() = 'admin' or public.student_can_access(student_id));
create policy "admin manages charges" on public.charges for all
using (public.current_app_role() = 'admin') with check (public.current_app_role() = 'admin');

create policy "adjustments visible to charge owner admin" on public.charge_adjustments for select
using (
  public.current_app_role() = 'admin'
  or exists (select 1 from public.charges c where c.id = charge_id and public.student_can_access(c.student_id))
);
create policy "admin manages charge adjustments" on public.charge_adjustments for all
using (public.current_app_role() = 'admin') with check (public.current_app_role() = 'admin');

create policy "payments visible to charge owner admin" on public.payments for select
using (
  public.current_app_role() = 'admin'
  or exists (select 1 from public.charges c where c.id = charge_id and public.student_can_access(c.student_id))
);
create policy "admin manages payments" on public.payments for all
using (public.current_app_role() = 'admin') with check (public.current_app_role() = 'admin');

create index students_class_status_idx on public.students(class_id, status) where archived_at is null;
create unique index students_enrollment_code_idx on public.students(enrollment_code) where enrollment_code is not null;
create index attendance_student_date_idx on public.attendance(student_id, class_date desc);
create index charges_student_competence_idx on public.charges(student_id, competence desc);
create index payments_charge_idx on public.payments(charge_id) where reversed_at is null;

create or replace function public.admin_import_backup(payload jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  item jsonb;
  source_id uuid;
  actual_id uuid;
  mapped_class uuid;
  mapped_student uuid;
  mapped_charge uuid;
  class_map jsonb := '{}'::jsonb;
  student_map jsonb := '{}'::jsonb;
  charge_map jsonb := '{}'::jsonb;
  imported_students integer := 0;
  imported_charges integer := 0;
begin
  if public.current_app_role() is distinct from 'admin' then
    raise exception 'Apenas administradores podem importar backups';
  end if;
  if jsonb_typeof(payload) is distinct from 'object' then
    raise exception 'O backup precisa ser um objeto JSON';
  end if;

  for item in select value from jsonb_array_elements(coalesce(payload -> 'classes', '[]'::jsonb))
  loop
    source_id := nullif(item ->> 'id', '')::uuid;
    actual_id := source_id;
    if source_id is not null and exists (select 1 from public.classes where id = source_id) then
      actual_id := source_id;
    else
      actual_id := coalesce(source_id, gen_random_uuid());
      insert into public.classes (id, name, level, weekdays, starts_at, capacity, active)
      values (
        actual_id, item ->> 'name', coalesce(item ->> 'level', 'iniciante'),
        array(select jsonb_array_elements_text(coalesce(item -> 'weekdays', '[]'::jsonb))::integer),
        coalesce((item ->> 'starts_at')::time, '18:00'::time),
        greatest(1, coalesce((item ->> 'capacity')::integer, 1)),
        coalesce((item ->> 'active')::boolean, true)
      ) on conflict do nothing;
    end if;
    if source_id is not null then class_map := jsonb_set(class_map, array[source_id::text], to_jsonb(actual_id::text), true); end if;
  end loop;

  for item in select value from jsonb_array_elements(coalesce(payload -> 'students', '[]'::jsonb))
  loop
    source_id := nullif(item ->> 'id', '')::uuid;
    select s.id into actual_id from public.students s
    where nullif(regexp_replace(coalesce(item ->> 'phone', ''), '[^0-9]', '', 'g'), '') is not null
      and regexp_replace(s.phone, '[^0-9]', '', 'g') = regexp_replace(item ->> 'phone', '[^0-9]', '', 'g')
    order by s.created_at limit 1;
    if actual_id is null then
      mapped_class := coalesce((class_map ->> (item ->> 'class_id'))::uuid, nullif(item ->> 'class_id', '')::uuid);
      actual_id := coalesce(source_id, gen_random_uuid());
      if source_id is not null and exists (select 1 from public.students where id = source_id) then
        actual_id := gen_random_uuid();
      end if;
      insert into public.students (
        id, name, phone, enrollment_code, class_id, plan, monthly_fee_cents, due_day,
        status, pause_until, notes, archived_at
      ) values (
        actual_id, item ->> 'name', coalesce(item ->> 'phone', ''), item ->> 'enrollment_code',
        mapped_class, coalesce(item ->> 'plan', 'Mensal'),
        greatest(0, coalesce((item ->> 'monthly_fee_cents')::integer, 0)),
        least(31, greatest(1, coalesce((item ->> 'due_day')::integer, 10))),
        case when item ->> 'status' in ('active', 'paused', 'inactive') then item ->> 'status' else 'active' end,
        nullif(item ->> 'pause_until', '')::date, coalesce(item ->> 'notes', ''),
        nullif(item ->> 'archived_at', '')::timestamptz
      ) on conflict do nothing;
      if not exists (select 1 from public.students where id = actual_id) then
        select s.id into actual_id from public.students s
        where regexp_replace(s.phone, '[^0-9]', '', 'g') = regexp_replace(coalesce(item ->> 'phone', ''), '[^0-9]', '', 'g')
          and coalesce(item ->> 'phone', '') <> '' limit 1;
      else
        imported_students := imported_students + 1;
      end if;
    end if;
    if source_id is not null and actual_id is not null then student_map := jsonb_set(student_map, array[source_id::text], to_jsonb(actual_id::text), true); end if;
  end loop;

  for item in select value from jsonb_array_elements(coalesce(payload -> 'charges', '[]'::jsonb))
  loop
    source_id := nullif(item ->> 'id', '')::uuid;
    mapped_student := coalesce((student_map ->> (item ->> 'student_id'))::uuid, nullif(item ->> 'student_id', '')::uuid);
    select c.id into actual_id from public.charges c
    where c.student_id = mapped_student and c.competence = (item ->> 'competence')::date limit 1;
    if actual_id is null then
      actual_id := coalesce(source_id, gen_random_uuid());
      insert into public.charges (id, student_id, competence, amount_cents, due_date)
      values (actual_id, mapped_student, (item ->> 'competence')::date,
        greatest(0, coalesce((item ->> 'amount_cents')::integer, 0)), (item ->> 'due_date')::date)
      on conflict do nothing;
      select c.id into actual_id from public.charges c
      where c.student_id = mapped_student and c.competence = (item ->> 'competence')::date limit 1;
      imported_charges := imported_charges + 1;
    end if;
    if source_id is not null and actual_id is not null then charge_map := jsonb_set(charge_map, array[source_id::text], to_jsonb(actual_id::text), true); end if;
  end loop;

  for item in select value from jsonb_array_elements(coalesce(payload -> 'payments', '[]'::jsonb))
  loop
    source_id := nullif(item ->> 'id', '')::uuid;
    mapped_charge := coalesce((charge_map ->> (item ->> 'charge_id'))::uuid, nullif(item ->> 'charge_id', '')::uuid);
    insert into public.payments (id, charge_id, amount_cents, paid_at, method, reversed_at, note)
    values (coalesce(source_id, gen_random_uuid()), mapped_charge,
      greatest(1, coalesce((item ->> 'amount_cents')::integer, 1)),
      coalesce(nullif(item ->> 'paid_at', '')::date, current_date),
      coalesce(item ->> 'method', 'manual'), nullif(item ->> 'reversed_at', '')::timestamptz,
      coalesce(item ->> 'note', ''))
    on conflict do nothing;
  end loop;

  for item in select value from jsonb_array_elements(coalesce(payload -> 'charge_adjustments', '[]'::jsonb))
  loop
    source_id := nullif(item ->> 'id', '')::uuid;
    mapped_charge := coalesce((charge_map ->> (item ->> 'charge_id'))::uuid, nullif(item ->> 'charge_id', '')::uuid);
    if item ->> 'kind' in ('discount', 'waiver', 'cancel', 'reversal') then
      insert into public.charge_adjustments (id, charge_id, kind, amount_cents, note)
      values (coalesce(source_id, gen_random_uuid()), mapped_charge, item ->> 'kind',
        greatest(1, coalesce((item ->> 'amount_cents')::integer, 1)), coalesce(item ->> 'note', ''))
      on conflict do nothing;
    end if;
  end loop;

  for item in select value from jsonb_array_elements(coalesce(payload -> 'attendance', '[]'::jsonb))
  loop
    source_id := nullif(item ->> 'id', '')::uuid;
    mapped_student := coalesce((student_map ->> (item ->> 'student_id'))::uuid, nullif(item ->> 'student_id', '')::uuid);
    mapped_class := coalesce((class_map ->> (item ->> 'class_id'))::uuid, nullif(item ->> 'class_id', '')::uuid);
    if item ->> 'status' in ('present', 'absent', 'makeup', 'excused') then
      insert into public.attendance (id, class_id, student_id, class_date, status, note)
      values (coalesce(source_id, gen_random_uuid()), mapped_class, mapped_student, (item ->> 'class_date')::date, item ->> 'status', coalesce(item ->> 'note', ''))
      on conflict (class_id, student_id, class_date) do nothing;
    end if;
  end loop;

  for item in select value from jsonb_array_elements(coalesce(payload -> 'makeups', '[]'::jsonb))
  loop
    source_id := nullif(item ->> 'id', '')::uuid;
    mapped_student := coalesce((student_map ->> (item ->> 'student_id'))::uuid, nullif(item ->> 'student_id', '')::uuid);
    mapped_class := coalesce((class_map ->> (item ->> 'class_id'))::uuid, nullif(item ->> 'class_id', '')::uuid);
    if item ->> 'status' in ('scheduled', 'used', 'cancelled') then
      insert into public.makeups (id, student_id, class_id, scheduled_for, status)
      values (coalesce(source_id, gen_random_uuid()), mapped_student, mapped_class, (item ->> 'scheduled_for')::date, item ->> 'status')
      on conflict do nothing;
    end if;
  end loop;

  for item in select value from jsonb_array_elements(coalesce(payload -> 'experiments', '[]'::jsonb))
  loop
    source_id := nullif(item ->> 'id', '')::uuid;
    mapped_class := coalesce((class_map ->> (item ->> 'class_id'))::uuid, nullif(item ->> 'class_id', '')::uuid);
    mapped_student := coalesce((student_map ->> (item ->> 'converted_student_id'))::uuid, nullif(item ->> 'converted_student_id', '')::uuid);
    if item ->> 'status' in ('scheduled', 'attended', 'follow_up', 'converted', 'closed') then
      insert into public.experiments (id, name, phone, class_id, scheduled_for, status, notes, converted_student_id)
      values (coalesce(source_id, gen_random_uuid()), item ->> 'name', coalesce(item ->> 'phone', ''),
        mapped_class, nullif(item ->> 'scheduled_for', '')::timestamptz, item ->> 'status',
        coalesce(item ->> 'notes', ''), mapped_student)
      on conflict do nothing;
    end if;
  end loop;

  return jsonb_build_object('students_imported', imported_students, 'charges_imported', imported_charges);
end;
$$;

revoke all on function public.handle_new_user() from public, anon, authenticated;
revoke all on function public.admin_convert_experiment(uuid) from public, anon;
revoke all on function public.set_student_enrollment_code() from public, anon, authenticated;
revoke all on function public.sync_student_class_membership() from public, anon, authenticated;
revoke all on function public.sync_makeup_attendance() from public, anon, authenticated;
revoke all on function public.guard_teacher_experiment_update() from public, anon, authenticated;
revoke all on function public.current_app_role() from public, anon;
revoke all on function public.student_can_access(uuid) from public, anon;
revoke all on function public.teacher_can_access_class(uuid) from public, anon;
revoke all on function public.teacher_can_mark_student(uuid, uuid, date) from public, anon;
revoke all on function public.admin_import_backup(jsonb) from public, anon;
grant execute on function public.current_app_role() to authenticated;
grant execute on function public.admin_convert_experiment(uuid) to authenticated;
grant execute on function public.student_can_access(uuid) to authenticated;
grant execute on function public.teacher_can_access_class(uuid) to authenticated;
grant execute on function public.teacher_can_mark_student(uuid, uuid, date) to authenticated;
grant execute on function public.admin_import_backup(jsonb) to authenticated;
grant usage on schema public to authenticated;
grant select, insert, update, delete on all tables in schema public to authenticated;
