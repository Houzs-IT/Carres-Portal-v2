-- Carres engine database: the people the Carres owner named under Settings editors -> Supply Chain.
-- The portal says so on every sign-in (engine/backend/src/carres/sso.ts keeps this list in step), and such a person
-- gets "settings.manage" on top of their role (services/auth.ts hydrateAuthUser), so they may change Supply Chain
-- Settings whatever role the Access & Roles page gives them.
-- REVERSAL: DROP TABLE public.carres_settings_editors;

CREATE TABLE IF NOT EXISTS public.carres_settings_editors (
  user_id bigint PRIMARY KEY REFERENCES public.users(id) ON DELETE CASCADE,
  named_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.carres_settings_editors ENABLE ROW LEVEL SECURITY;
