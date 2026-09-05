/* =====================================================================
   PATRICIA DAADIN — conexión a Supabase
   La "publishable key" es pública por diseño (equivalente a la anon key
   de proyectos nuevos de Supabase): solo permite lo que las políticas
   de RLS habiliten para el rol "anon". No es un secreto.
   PENDIENTE: correr supabase/schema.sql en este proyecto (SQL Editor)
   si todavía no se corrió.
   ===================================================================== */

const SUPABASE_URL = "https://kfwmlggzarzoakbigxbd.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_4rcY_yid15wqCfMlWFdF4w__mfFGYKk";

const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
