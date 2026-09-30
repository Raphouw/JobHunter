begin;
create temporary table cv_test_ids as select gen_random_uuid() u1, gen_random_uuid() u2, gen_random_uuid() p1, gen_random_uuid() p2, gen_random_uuid() cv1;
grant select on cv_test_ids to authenticated;
insert into auth.users(id) select u1 from cv_test_ids union all select u2 from cv_test_ids;
insert into public.hunter_profiles(id,user_id,name) select p1,u1,'CV integration test A' from cv_test_ids union all select p2,u2,'CV integration test B' from cv_test_ids;
select set_config('request.jwt.claim.sub',(select u1::text from cv_test_ids),true);
set local role authenticated;
insert into public.hunter_cvs(id,user_id,profile_id,title,content) select cv1,u1,p1,'Test CV','{"version":17,"name":"Test"}'::jsonb from cv_test_ids;
do $$ begin
  if (select count(*) from public.hunter_cvs) <> 1 then raise exception 'Owner SELECT failed'; end if;
  update public.hunter_cvs set title='Renamed' where id=(select cv1 from cv_test_ids);
  if (select revision from public.hunter_cvs where id=(select cv1 from cv_test_ids)) <> 1 then raise exception 'Revision trigger failed'; end if;
  begin
    insert into public.hunter_cvs(user_id,profile_id,title) select u2,p2,'Forbidden' from cv_test_ids;
    raise exception 'Foreign owner INSERT was allowed';
  exception when insufficient_privilege then null; end;
  begin
    update public.hunter_cvs set user_id=(select u2 from cv_test_ids),profile_id=(select p2 from cv_test_ids);
    raise exception 'Ownership reassignment was allowed';
  exception when insufficient_privilege then null; end;
  begin
    insert into public.hunter_cvs(user_id,profile_id,title) select u1,p2,'Foreign profile' from cv_test_ids;
    raise exception 'Foreign profile INSERT was allowed';
  exception when foreign_key_violation then null; end;
end $$;
select set_config('request.jwt.claim.sub',(select u2::text from cv_test_ids),true);
do $$ begin
  if exists(select 1 from public.hunter_cvs) then raise exception 'Other account SELECT allowed'; end if;
  update public.hunter_cvs set title='Forbidden';
  if found then raise exception 'Other account UPDATE allowed'; end if;
  delete from public.hunter_cvs;
  if found then raise exception 'Other account DELETE allowed'; end if;
end $$;
select set_config('request.jwt.claim.sub',(select u1::text from cv_test_ids),true);
delete from public.hunter_cvs where id=(select cv1 from cv_test_ids);
do $$ begin
  if exists(select 1 from public.hunter_cvs) then raise exception 'Owner DELETE failed'; end if;
end $$;
reset role;
do $$ begin
  if has_table_privilege('anon','public.hunter_cvs','select') or has_table_privilege('anon','public.hunter_cvs','insert') or has_table_privilege('anon','public.hunter_cvs','update') or has_table_privilege('anon','public.hunter_cvs','delete') then raise exception 'Anonymous CV access allowed'; end if;
end $$;
select 'CV CRUD, optimistic revision, account/profile isolation and anonymous denial: PASS' as result;
rollback;
