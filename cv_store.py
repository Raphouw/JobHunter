"""Profile-scoped SQLite persistence for the local CV library."""
import json
import sqlite3
import uuid
from contextlib import closing
from datetime import datetime, timezone


def cv_request(path, action, values=None):
    values = values or {}
    path.parent.mkdir(parents=True, exist_ok=True)
    with closing(sqlite3.connect(path, timeout=20)) as conn, conn:
        conn.row_factory = sqlite3.Row
        conn.execute('''create table if not exists hunter_cvs (
          id text primary key, title text not null, content text,
          revision integer not null default 0, updated_at text not null)''')

        def decode(row):
            if row is None:
                raise ValueError('CV introuvable')
            item = dict(row)
            if 'content' in item:
                item['content'] = json.loads(item['content']) if item['content'] else None
            return item

        if action == 'list':
            return [dict(row) for row in conn.execute('select id,title,revision,updated_at from hunter_cvs order by updated_at desc')]
        identifier = values.get('id', '')
        if action == 'get':
            return decode(conn.execute('select * from hunter_cvs where id=?', (identifier,)).fetchone())
        if action == 'delete':
            conn.execute('delete from hunter_cvs where id=?', (identifier,))
            return {'ok': True}
        if action not in {'create', 'save'}:
            raise ValueError('Action CV invalide')
        title = str(values.get('title', '')).strip()
        if not title or len(title) > 120:
            raise ValueError('Le titre doit contenir entre 1 et 120 caractères')
        content = values.get('content')
        if content is not None and not isinstance(content, dict):
            raise ValueError('Contenu CV invalide')
        serialized = json.dumps(content, ensure_ascii=False) if content is not None else None
        if serialized and len(serialized.encode('utf-8')) > 1_800_000:
            raise ValueError('CV trop volumineux (1,8 Mo maximum). Réduis la taille de la photo.')
        now = datetime.now(timezone.utc).isoformat()
        if action == 'create':
            identifier = str(uuid.uuid4())
            conn.execute('insert into hunter_cvs(id,title,content,updated_at) values(?,?,?,?)', (identifier, title, serialized, now))
        else:
            revision = values.get('revision')
            if not isinstance(revision, int):
                raise ValueError('Révision CV invalide')
            changed = conn.execute('update hunter_cvs set title=?,content=?,updated_at=?,revision=revision+1 where id=? and revision=?',
                (title, serialized, now, identifier, revision)).rowcount
            if not changed:
                raise ValueError('Ce CV a été modifié ou supprimé. Recharge-le avant de sauvegarder. Ton brouillon est conservé.')
        return decode(conn.execute('select * from hunter_cvs where id=?', (identifier,)).fetchone())
