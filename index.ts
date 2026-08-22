// supabase/functions/telegram-auth/index.ts
//
// This is the ONLY piece of the app that ever sees your Telegram bot
// token or your Supabase JWT secret. The browser can never verify
// Telegram's signature itself (that would mean shipping the bot token
// to every phone), so it hands over the raw `initData` string here,
// and this function:
//
//   1. Recomputes Telegram's HMAC signature and checks it matches,
//      proving the data really came from Telegram in the last hour.
//   2. Finds or creates a row in `profiles` for that Telegram user.
//   3. Signs a short-lived Supabase-compatible JWT for that profile,
//      following Supabase's documented "bring your own auth" pattern:
//      https://supabase.com/docs/guides/auth/jwts
//
// Deploy:
//   supabase functions deploy telegram-auth
//
// Secrets (Project Settings -> Edge Functions -> Secrets, or CLI):
//   supabase secrets set TELEGRAM_BOT_TOKEN=123456789:AA...bot-token-from-BotFather
//   supabase secrets set SUPABASE_JWT_SECRET=<Project Settings -> API -> JWT Keys -> Legacy JWT Secret>
//
// Config (supabase/config.toml) — see the config.toml delivered alongside
// this file:
//   [functions.telegram-auth]
//   verify_jwt = false

import { withSupabase } from 'npm:@supabase/server@^1'

const TELEGRAM_BOT_TOKEN = Deno.env.get('TELEGRAM_BOT_TOKEN') ?? ''
const JWT_SECRET = Deno.env.get('SUPABASE_JWT_SECRET') ?? ''

// initData is reissued by Telegram every time the Mini App is opened, so
// this only needs to be generous enough to cover slow networks/clock skew.
const MAX_INIT_DATA_AGE_SECONDS = 3600
const SESSION_LIFETIME_SECONDS = 3600

interface TelegramUser {
  id: number
  first_name?: string
  last_name?: string
  username?: string
  photo_url?: string
}

// ---------- Web Crypto helpers (no external crypto/JWT dependency) ----------

async function hmacSha256(keyBytes: Uint8Array, message: string): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    'raw',
    keyBytes,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message))
  return new Uint8Array(sig)
}

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('')
}

function base64url(bytes: Uint8Array): string {
  const str = btoa(String.fromCharCode(...bytes))
  return str.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

async function signHS256Jwt(payload: Record<string, unknown>, secret: string): Promise<string> {
  const header = { alg: 'HS256', typ: 'JWT' }
  const encHeader = base64url(new TextEncoder().encode(JSON.stringify(header)))
  const encPayload = base64url(new TextEncoder().encode(JSON.stringify(payload)))
  const signingInput = `${encHeader}.${encPayload}`
  const sig = await hmacSha256(new TextEncoder().encode(secret), signingInput)
  return `${signingInput}.${base64url(sig)}`
}

// ---------- Telegram initData verification ----------
// Algorithm per https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app
// (verified against a known-good test vector before this function was written)

async function verifyTelegramInitData(
  initData: string,
  botToken: string,
): Promise<{ user: TelegramUser }> {
  const params = new URLSearchParams(initData)
  const hash = params.get('hash')
  if (!hash) throw new Error('Malformed Telegram data')
  params.delete('hash')

  const dataCheckString = Array.from(params.entries())
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([key, value]) => `${key}=${value}`)
    .join('\n')

  const secretKey = await hmacSha256(new TextEncoder().encode('WebAppData'), botToken)
  const computedHash = toHex(await hmacSha256(secretKey, dataCheckString))

  if (computedHash !== hash) {
    throw new Error('Invalid Telegram signature')
  }

  const authDate = Number(params.get('auth_date') ?? '0')
  const ageSeconds = Date.now() / 1000 - authDate
  if (!authDate || ageSeconds > MAX_INIT_DATA_AGE_SECONDS || ageSeconds < -60) {
    throw new Error('Telegram session has expired, please reopen the app')
  }

  const userRaw = params.get('user')
  if (!userRaw) throw new Error('Missing Telegram user in initData')

  return { user: JSON.parse(userRaw) as TelegramUser }
}

// ---------- handler ----------

export default {
  fetch: withSupabase({ auth: 'none' }, async (req, ctx) => {
    if (req.method !== 'POST') {
      return Response.json({ error: 'Use POST' }, { status: 405 })
    }

    if (!TELEGRAM_BOT_TOKEN || !JWT_SECRET) {
      console.error('telegram-auth: missing TELEGRAM_BOT_TOKEN or SUPABASE_JWT_SECRET secret')
      return Response.json({ error: 'Server is not configured yet' }, { status: 500 })
    }

    let initData: unknown
    try {
      const body = await req.json()
      initData = body?.initData
    } catch {
      return Response.json({ error: 'Malformed request body' }, { status: 400 })
    }
    if (!initData || typeof initData !== 'string') {
      return Response.json({ error: 'Missing initData in request body' }, { status: 400 })
    }

    let tgUser: TelegramUser
    try {
      const result = await verifyTelegramInitData(initData, TELEGRAM_BOT_TOKEN)
      tgUser = result.user
    } catch (err) {
      return Response.json({ error: (err as Error).message }, { status: 401 })
    }

    // Find (or create) the profile row tied to this Telegram account.
    const { data: existingProfile, error: lookupError } = await ctx.supabaseAdmin
      .from('profiles')
      .select('*')
      .eq('telegram_id', tgUser.id)
      .maybeSingle()

    if (lookupError) {
      console.error('telegram-auth: profile lookup failed', lookupError)
      return Response.json({ error: 'Could not look up profile' }, { status: 500 })
    }

    let profile = existingProfile
    let isNewProfile = false

    if (!profile) {
      const displayName =
        [tgUser.first_name, tgUser.last_name].filter(Boolean).join(' ').trim() ||
        tgUser.username ||
        'UNN Student'

      const { data: created, error: insertError } = await ctx.supabaseAdmin
        .from('profiles')
        .insert({
          telegram_id: tgUser.id,
          telegram_username: tgUser.username ?? null,
          telegram_first_name: tgUser.first_name ?? null,
          telegram_last_name: tgUser.last_name ?? null,
          telegram_photo_url: tgUser.photo_url ?? null,
          display_name: displayName,
        })
        .select('*')
        .single()

      if (insertError) {
        console.error('telegram-auth: profile insert failed', insertError)
        return Response.json({ error: 'Could not create profile' }, { status: 500 })
      }
      profile = created
      isNewProfile = true
    } else {
      // Telegram name/username/photo can change — keep them fresh.
      const { data: updated, error: updateError } = await ctx.supabaseAdmin
        .from('profiles')
        .update({
          telegram_username: tgUser.username ?? null,
          telegram_first_name: tgUser.first_name ?? null,
          telegram_last_name: tgUser.last_name ?? null,
          telegram_photo_url: tgUser.photo_url ?? null,
        })
        .eq('id', profile.id)
        .select('*')
        .single()

      if (!updateError && updated) profile = updated
    }

    const nowSeconds = Math.floor(Date.now() / 1000)
    const token = await signHS256Jwt(
      {
        sub: profile.id,
        role: 'authenticated',
        aud: 'authenticated',
        telegram_id: profile.telegram_id,
        iat: nowSeconds,
        exp: nowSeconds + SESSION_LIFETIME_SECONDS,
      },
      JWT_SECRET,
    )

    return Response.json({
      token,
      expiresAt: (nowSeconds + SESSION_LIFETIME_SECONDS) * 1000,
      isNewProfile,
      profile,
    })
  }),
}
