export function cvRepository({ supabase, userId, profileId }) {
  async function local(action, values = {}) {
    const response = await fetch('/api/cvs' + (action === 'list' ? `?profile=${encodeURIComponent(profileId)}` : ''),
      action === 'list' ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ profile: profileId, action, ...values }) });
    const result = await response.json();
    if (!response.ok || result.error) throw new Error(result.error || 'Impossible de sauvegarder le CV');
    return result;
  }
  function scope(query) { return query.eq('user_id', userId).eq('profile_id', profileId); }
  async function unwrap(query) { const { data, error } = await query; if (error) throw error; return data; }
  return {
    list: () => supabase ? unwrap(scope(supabase.from('hunter_cvs').select('id,title,updated_at,revision')).order('updated_at', { ascending: false })) : local('list'),
    get: id => supabase ? unwrap(scope(supabase.from('hunter_cvs').select('*')).eq('id', id).single()) : local('get', { id }),
    create: (title, content = null) => supabase ? unwrap(supabase.from('hunter_cvs').insert({ user_id:userId, profile_id:profileId, title, content }).select().single()) : local('create', { title, content }),
    async save(row, title, content) {
      const result = supabase ? await unwrap(scope(supabase.from('hunter_cvs').update({ title, content, revision:row.revision + 1 }))
        .eq('id', row.id).eq('revision', row.revision).select().maybeSingle()) : await local('save', { id:row.id, revision:row.revision, title, content });
      if (!result) throw new Error('Ce CV a été modifié dans une autre fenêtre. Recharge-le avant de sauvegarder. Ton brouillon est conservé.');
      return result;
    },
    async remove(id) {
      if (supabase) await unwrap(scope(supabase.from('hunter_cvs').delete()).eq('id', id));
      else await local('delete', { id });
    },
  };
}
