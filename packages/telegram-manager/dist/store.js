export async function createTelegramPairing(sql, pairing) {
    return sql.begin(async (tx) => {
        // ponytail: serialize admission up to 1,000 active pairings; partition if demand grows.
        await tx `SELECT pg_advisory_xact_lock(74839201)`;
        await tx `DELETE FROM telegram_pairings WHERE expires_at <= CURRENT_TIMESTAMP`;
        const [row] = await tx `SELECT count(*)::int AS count FROM telegram_pairings`;
        if (row.count >= 1000) {
            return false;
        }
        await tx `INSERT INTO telegram_pairings (id, secret_hash, suggested_username, expires_at)
      VALUES (${pairing.id}, ${pairing.secretHash}, ${pairing.suggestedUsername}, ${pairing.expiresAt.toISOString()})`;
        return true;
    });
}
export async function getTelegramPairing(sql, id, secretHash) {
    const [row] = await sql `SELECT * FROM telegram_pairings
    WHERE id = ${id} AND secret_hash = ${secretHash} AND expires_at > CURRENT_TIMESTAMP`;
    return row ?? null;
}
export async function deleteTelegramPairing(sql, id, secretHash) {
    await sql `DELETE FROM telegram_pairings WHERE id = ${id} AND secret_hash = ${secretHash}`;
}
export async function bindTelegramPairing(sql, id, ownerUserId) {
    const [row] = await sql `UPDATE telegram_pairings SET owner_user_id = ${ownerUserId}
    WHERE id = ${id} AND expires_at > CURRENT_TIMESTAMP AND bot_id IS NULL
      AND (owner_user_id IS NULL OR owner_user_id = ${ownerUserId}) RETURNING *`;
    return row ?? null;
}
export async function completeTelegramPairing(sql, bot) {
    await sql.begin(async (tx) => {
        // A transferred bot must no longer be claimable by the previous owner.
        await tx `DELETE FROM telegram_pairings WHERE bot_id = ${bot.id} AND owner_user_id <> ${bot.ownerUserId}`;
        await tx `UPDATE telegram_pairings SET bot_id = ${bot.id}, bot_username = ${bot.username}
      WHERE suggested_username = ${bot.username.toLowerCase()} AND owner_user_id = ${bot.ownerUserId}
        AND bot_id IS NULL AND expires_at > CURRENT_TIMESTAMP`;
    });
}
