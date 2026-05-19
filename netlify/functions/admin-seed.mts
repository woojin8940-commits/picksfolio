import { createClient } from "@supabase/supabase-js";
import { getDatabase } from "@netlify/database";

const SUPABASE_URL = "https://rjksilpewohjvtbxrsvu.supabase.co";

const ADMIN_ACCOUNTS = [
  { username: "picksfolio", password: "picksfolio12@", full_name: "Picksfolio Admin" },
];

function getSupabaseAdmin() {
  const serviceKey = Netlify.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!serviceKey) throw new Error("Missing SUPABASE_SERVICE_ROLE_KEY");
  return createClient(SUPABASE_URL, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

function generateProfileCode(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i < 6; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}

export default async (req: Request) => {
  if (req.method !== "POST") {
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }

  const results: { username: string; status: string }[] = [];

  try {
    const supabase = getSupabaseAdmin();
    const db = getDatabase();

    for (const account of ADMIN_ACCOUNTS) {
      const email = `${account.username}@picks.me`;

      const { data: existingProfile } = await supabase
        .from("profiles")
        .select("id")
        .eq("username", account.username)
        .maybeSingle();

      if (existingProfile) {
        results.push({ username: account.username, status: "already_exists" });
        continue;
      }

      const { data: authData, error: authError } =
        await supabase.auth.admin.createUser({
          email,
          password: account.password,
          email_confirm: true,
          user_metadata: {
            full_name: account.full_name,
          },
        });

      if (authError) {
        if (authError.message.includes("already been registered")) {
          results.push({ username: account.username, status: "auth_exists" });
          continue;
        }
        results.push({ username: account.username, status: `error: ${authError.message}` });
        continue;
      }

      if (authData.user) {
        await supabase.from("profiles").upsert(
          {
            id: authData.user.id,
            username: account.username,
            email,
            full_name: account.full_name,
            role: "admin",
          },
          { onConflict: "id" }
        );

        let profileCode = generateProfileCode();
        try {
          const initialData = {
            profile: { name: account.full_name, bio: "", avatar_url: "" },
            design: {},
            socials: {},
            category: "",
            tags: [],
            blocks: [],
          };

          await db.sql`
            INSERT INTO site_data (username, data, profile_code)
            VALUES (${account.username}, ${JSON.stringify(initialData)}, ${profileCode})
            ON CONFLICT (username) DO NOTHING
          `;
        } catch {}
      }

      results.push({ username: account.username, status: "created" });
    }

    return Response.json({ success: true, results });
  } catch (err: any) {
    return Response.json({ success: false, error: err?.message }, { status: 500 });
  }
};
