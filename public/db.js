// Port of db.py's queries, run through sqlClient.js against the in-browser
// sql.js database instead of a live sqlite3.Connection. Same SQL, same
// schema assumptions.

export async function listChats(sql) {
  return sql.exec(`
    SELECT c.ROWID AS rowid,
           c.chat_identifier AS chat_identifier,
           c.display_name AS display_name,
           COUNT(chj.handle_id) AS participant_count
    FROM chat c
    LEFT JOIN chat_handle_join chj ON chj.chat_id = c.ROWID
    GROUP BY c.ROWID
    ORDER BY participant_count DESC, c.ROWID ASC
  `);
}

export async function getChat(sql, chatId) {
  const rows = await sql.exec(
    `
    SELECT c.ROWID AS rowid,
           c.chat_identifier AS chat_identifier,
           c.display_name AS display_name,
           COUNT(chj.handle_id) AS participant_count
    FROM chat c
    LEFT JOIN chat_handle_join chj ON chj.chat_id = c.ROWID
    WHERE c.ROWID = ?
    GROUP BY c.ROWID
  `,
    [chatId]
  );
  return rows[0] || null;
}

export async function fetchMessages(sql, chatId) {
  const rows = await sql.exec(
    `
    SELECT m.ROWID AS rowid,
           m.guid AS guid,
           m.date AS date,
           m.is_from_me AS is_from_me,
           h.id AS handle_id,
           m.text AS text,
           m.attributedBody AS attributed_body,
           m.associated_message_type AS associated_message_type,
           m.associated_message_guid AS associated_message_guid,
           m.associated_message_emoji AS associated_message_emoji
    FROM message m
    JOIN chat_message_join cmj ON cmj.message_id = m.ROWID
    LEFT JOIN handle h ON h.ROWID = m.handle_id
    WHERE cmj.chat_id = ?
    ORDER BY m.date ASC
  `,
    [chatId]
  );

  // Normalize the same way db.py does (NULL associated_message_type -> 0,
  // is_from_me as a real boolean).
  return rows.map((row) => ({
    ...row,
    is_from_me: Boolean(row.is_from_me),
    associated_message_type: row.associated_message_type ?? 0,
  }));
}
