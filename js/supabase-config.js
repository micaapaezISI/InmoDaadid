/* =====================================================================
   PATRICIA DAADIN — conexión a Supabase
   PENDIENTE: falta crear un proyecto de Supabase propio para este sitio
   (no reutilizar el de Inmobiliaria Ramirez — son clientas distintas).
   Reemplazar los dos valores de abajo por los reales una vez creado el
   proyecto. La "publishable key" es pública por diseño (equivalente a
   la anon key de proyectos nuevos de Supabase): solo permite lo que las
   políticas de RLS habiliten para el rol "anon". No es un secreto.
   ===================================================================== */

const SUPABASE_URL = "https://PENDIENTE.supabase.co";
const SUPABASE_ANON_KEY = "PENDIENTE-crear-proyecto-supabase";

const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
