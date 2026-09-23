Vamos a implementar Rebanada 6: white-label por clínica (CLI-06).
Sigue exactamente este orden. No te saltes pasos, no toques archivos fuera de los listados.

────────────────────────────────────────────────────────────
PASO 1 — MIGRACIÓN
────────────────────────────────────────────────────────────

Crea el archivo apps/api/migrations/008-brand-config.sql con este contenido exacto:

```sql
-- migration: 008-brand-config
-- Configuración visual (white-label) por clínica.
-- Una sola fila por clínica; si no existe → se usan defaults en el API.
BEGIN;

CREATE TABLE brand_config (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  clinica_id     UUID        NOT NULL REFERENCES clinicas(id),
  nombre_app     TEXT        NOT NULL DEFAULT 'NutriSmart',
  logo_url       TEXT,
  color_primario VARCHAR(7)  NOT NULL DEFAULT '#16a34a',
  color_acento   VARCHAR(7)  NOT NULL DEFAULT '#0ea5e9',
  creado_en      TIMESTAMPTZ NOT NULL DEFAULT now(),
  actualizado_en TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT brand_config_clinica_unica UNIQUE (clinica_id)
);

CREATE TRIGGER trg_brand_config_updated_at
  BEFORE UPDATE ON brand_config
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMIT;
```

────────────────────────────────────────────────────────────
PASO 2 — RUTA API
────────────────────────────────────────────────────────────

Crea apps/api/src/routes/brand.ts con este contenido:

```typescript
import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { Pool } from 'pg';
import { AlmacenArchivos } from '../storage/AlmacenArchivos.js';
import { createHash } from 'node:crypto';

interface BrandRow {
  nombre_app: string;
  logo_url: string | null;
  color_primario: string;
  color_acento: string;
}

const DEFAULTS: BrandRow = {
  nombre_app: 'NutriSmart',
  logo_url: null,
  color_primario: '#16a34a',
  color_acento: '#0ea5e9',
};

const MAGIC: Record<string, Buffer> = {
  'image/png':  Buffer.from([0x89, 0x50, 0x4e, 0x47]),
  'image/jpeg': Buffer.from([0xff, 0xd8, 0xff]),
  'image/webp': Buffer.from([0x52, 0x49, 0x46, 0x46]),
};
const SVG_OPEN = Buffer.from('<svg');
const SVG_XML  = Buffer.from('<?xml');
const MAX_LOGO_BYTES = 512 * 1024;

function detectMime(buf: Buffer): string | null {
  for (const [mime, magic] of Object.entries(MAGIC)) {
    if (buf.subarray(0, magic.length).equals(magic)) return mime;
  }
  const head = buf.subarray(0, 5);
  if (head.subarray(0, 4).equals(SVG_OPEN) || head.equals(SVG_XML.subarray(0, 5))) {
    return 'image/svg+xml';
  }
  return null;
}

function validarHex(color: string): boolean {
  return /^#[0-9a-fA-F]{6}$/.test(color);
}

async function requireAdmin(req: FastifyRequest, reply: FastifyReply) {
  // @ts-ignore
  const rol: string = req.auth?.rol ?? '';
  if (rol !== 'admin_clinica') {
    return reply.status(403).send({ error: 'Solo admin_clinica puede modificar la configuración de marca' });
  }
}

export async function brandRoutes(
  app: FastifyInstance,
  opts: { db: Pool; almacen: AlmacenArchivos }
) {
  const { db, almacen } = opts;

  // GET /api/brand — semi-público (sin JWT usa ?clinica=uuid)
  app.get('/api/brand', async (req: FastifyRequest, reply: FastifyReply) => {
    let clinicaId: string | null = null;
    // @ts-ignore
    if (req.auth?.clinica_id) { clinicaId = req.auth.clinica_id; }
    else {
      const q = (req.query as Record<string, string>).clinica ?? null;
      if (q && /^[0-9a-f-]{36}$/.test(q)) clinicaId = q;
    }
    if (!clinicaId) {
      return reply.send({ ...DEFAULTS, tiene_logo: false, logo_url: null });
    }
    const { rows } = await db.query<BrandRow>(
      `SELECT nombre_app, logo_url, color_primario, color_acento
         FROM brand_config WHERE clinica_id = $1`,
      [clinicaId]
    );
    const row = rows[0] ?? DEFAULTS;
    return reply.send({
      nombre_app:     row.nombre_app,
      logo_url:       row.logo_url ? '/api/brand/logo' : null,
      color_primario: row.color_primario,
      color_acento:   row.color_acento,
      tiene_logo:     !!row.logo_url,
    });
  });

  // PUT /api/brand — solo admin_clinica
  app.put('/api/brand', { preHandler: [app.authenticate, requireAdmin] },
    async (req: FastifyRequest, reply: FastifyReply) => {
      // @ts-ignore
      const clinicaId: string = req.auth.clinica_id;
      const body = req.body as { nombre_app?: string; color_primario?: string; color_acento?: string };

      if (body.nombre_app !== undefined) {
        if (typeof body.nombre_app !== 'string' || body.nombre_app.trim().length === 0 || body.nombre_app.length > 80)
          return reply.status(400).send({ error: 'nombre_app debe tener 1-80 caracteres' });
      }
      if (body.color_primario !== undefined && !validarHex(body.color_primario))
        return reply.status(400).send({ error: 'color_primario debe ser #rrggbb' });
      if (body.color_acento !== undefined && !validarHex(body.color_acento))
        return reply.status(400).send({ error: 'color_acento debe ser #rrggbb' });

      const { rows } = await db.query<BrandRow>(
        `INSERT INTO brand_config (clinica_id, nombre_app, color_primario, color_acento)
              VALUES ($1, COALESCE($2,'NutriSmart'), COALESCE($3,'#16a34a'), COALESCE($4,'#0ea5e9'))
         ON CONFLICT (clinica_id) DO UPDATE
            SET nombre_app     = COALESCE($2, brand_config.nombre_app),
                color_primario = COALESCE($3, brand_config.color_primario),
                color_acento   = COALESCE($4, brand_config.color_acento),
                actualizado_en = now()
         RETURNING nombre_app, logo_url, color_primario, color_acento`,
        [clinicaId, body.nombre_app?.trim() ?? null, body.color_primario ?? null, body.color_acento ?? null]
      );
      const row = rows[0];
      return reply.send({
        nombre_app: row.nombre_app, logo_url: row.logo_url ? '/api/brand/logo' : null,
        color_primario: row.color_primario, color_acento: row.color_acento, tiene_logo: !!row.logo_url,
      });
    }
  );

  // PUT /api/brand/logo — sube o reemplaza logo
  app.put('/api/brand/logo', { preHandler: [app.authenticate, requireAdmin] },
    async (req: FastifyRequest, reply: FastifyReply) => {
      // @ts-ignore
      const clinicaId: string = req.auth.clinica_id;
      // @ts-ignore
      const data = await req.file();
      if (!data) return reply.status(400).send({ error: 'Falta campo logo en multipart' });

      const chunks: Buffer[] = [];
      let total = 0;
      for await (const chunk of data.file) {
        total += chunk.length;
        if (total > MAX_LOGO_BYTES) return reply.status(400).send({ error: 'Logo excede 512 KB' });
        chunks.push(chunk);
      }
      const buf = Buffer.concat(chunks);
      const mime = detectMime(buf);
      if (!mime) return reply.status(400).send({ error: 'Formato no permitido. Se aceptan PNG, JPEG, WebP y SVG.' });

      const prev = await db.query<{ logo_url: string | null }>(
        'SELECT logo_url FROM brand_config WHERE clinica_id = $1', [clinicaId]
      );
      const logoAnterior = prev.rows[0]?.logo_url ?? null;

      const uuid = createHash('sha256').update(buf).update(clinicaId).digest('hex').slice(0, 32);
      const rutaInterna = `logos/${uuid}`;
      await almacen.guardar(rutaInterna, buf);

      await db.query(
        `INSERT INTO brand_config (clinica_id, logo_url)
              VALUES ($1, $2)
         ON CONFLICT (clinica_id) DO UPDATE SET logo_url = $2, actualizado_en = now()`,
        [clinicaId, rutaInterna]
      );
      if (logoAnterior) await almacen.eliminar(logoAnterior).catch(() => {});
      return reply.send({ logo_url: '/api/brand/logo' });
    }
  );

  // GET /api/brand/logo — público, sirve inline
  app.get('/api/brand/logo', async (req: FastifyRequest, reply: FastifyReply) => {
    let clinicaId: string | null = null;
    // @ts-ignore
    if (req.auth?.clinica_id) { clinicaId = req.auth.clinica_id; }
    else {
      const q = (req.query as Record<string, string>).clinica ?? null;
      if (q && /^[0-9a-f-]{36}$/.test(q)) clinicaId = q;
    }
    if (!clinicaId) return reply.status(404).send({ error: 'No hay logo configurado' });

    const { rows } = await db.query<{ logo_url: string | null }>(
      'SELECT logo_url FROM brand_config WHERE clinica_id = $1', [clinicaId]
    );
    const rutaInterna = rows[0]?.logo_url;
    if (!rutaInterna) return reply.status(404).send({ error: 'No hay logo configurado' });

    const buf = await almacen.leer(rutaInterna).catch(() => null);
    if (!buf) return reply.status(404).send({ error: 'Archivo de logo no encontrado' });

    const mime = detectMime(buf) ?? 'application/octet-stream';
    reply.header('Content-Type', mime);
    reply.header('Cache-Control', 'public, max-age=86400');
    return reply.send(buf);
  });

  // DELETE /api/brand/logo
  app.delete('/api/brand/logo', { preHandler: [app.authenticate, requireAdmin] },
    async (req: FastifyRequest, reply: FastifyReply) => {
      // @ts-ignore
      const clinicaId: string = req.auth.clinica_id;
      const { rows } = await db.query<{ logo_url: string | null }>(
        'SELECT logo_url FROM brand_config WHERE clinica_id = $1', [clinicaId]
      );
      const ruta = rows[0]?.logo_url;
      if (ruta) {
        await almacen.eliminar(ruta).catch(() => {});
        await db.query('UPDATE brand_config SET logo_url = NULL, actualizado_en = now() WHERE clinica_id = $1', [clinicaId]);
      }
      return reply.status(204).send();
    }
  );
}
```

────────────────────────────────────────────────────────────
PASO 3 — REGISTRAR RUTA EN index.ts
────────────────────────────────────────────────────────────

Lee apps/api/src/index.ts y:
1. Agrega al bloque de imports de rutas: `import { brandRoutes } from './routes/brand.js';`
2. Agrega en el bloque donde se registran las rutas (junto a laboratoriosRoutes):
   `await app.register(brandRoutes, { db, almacen });`

IMPORTANTE: Los endpoints GET /api/brand y GET /api/brand/logo no deben fallar si no hay
Authorization header. Revisa si el hook global `app.authenticate` lanza 401 cuando no hay token.
Si lo hace, registra brandRoutes ANTES de añadir el hook global, o usa una guard interna.
Examina el patrón de auth existente y aplica la solución menos invasiva.

────────────────────────────────────────────────────────────
PASO 4 — AlmacenArchivos: método leer y eliminar
────────────────────────────────────────────────────────────

Lee apps/api/src/storage/AlmacenArchivos.ts.
Si la interfaz AlmacenArchivos NO tiene los métodos `leer(ruta: string): Promise<Buffer>`
y `eliminar(ruta: string): Promise<void>`, agrégalos tanto a la interfaz como a la implementación local.
Si ya existen con otro nombre, usa ese nombre en brand.ts.

────────────────────────────────────────────────────────────
PASO 5 — CONTEXTO DE MARCA (frontend)
────────────────────────────────────────────────────────────

Crea apps/web-professional/src/contexts/BrandContext.tsx:

```tsx
import React, { createContext, useContext, useEffect, useState, ReactNode } from 'react';

export interface BrandConfig {
  nombre_app: string;
  logo_url: string | null;
  color_primario: string;
  color_acento: string;
  tiene_logo: boolean;
}

const BRAND_DEFAULTS: BrandConfig = {
  nombre_app: 'NutriSmart',
  logo_url: null,
  color_primario: '#16a34a',
  color_acento: '#0ea5e9',
  tiene_logo: false,
};

interface BrandContextValue {
  brand: BrandConfig;
  cargando: boolean;
  refrescar: () => Promise<void>;
}

const BrandContext = createContext<BrandContextValue>({
  brand: BRAND_DEFAULTS,
  cargando: false,
  refrescar: async () => {},
});

export function BrandProvider({ children, token }: { children: ReactNode; token: string | null }) {
  const [brand, setBrand] = useState<BrandConfig>(BRAND_DEFAULTS);
  const [cargando, setCargando] = useState(false);

  async function cargar() {
    if (!token) return;
    setCargando(true);
    try {
      const res = await fetch('/api/brand', {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data: BrandConfig = await res.json();
        setBrand(data);
        aplicarCssVariables(data);
        actualizarTitulo(data.nombre_app);
      }
    } catch { /* usa defaults */ }
    finally { setCargando(false); }
  }

  useEffect(() => { cargar(); }, [token]);

  return (
    <BrandContext.Provider value={{ brand, cargando, refrescar: cargar }}>
      {children}
    </BrandContext.Provider>
  );
}

export function useBrand() { return useContext(BrandContext); }

function aplicarCssVariables(brand: BrandConfig) {
  const root = document.documentElement;
  root.style.setProperty('--color-primary', brand.color_primario);
  root.style.setProperty('--color-accent',  brand.color_acento);
  root.style.setProperty('--color-primary-hover', oscurecer(brand.color_primario, 0.15));
  root.style.setProperty('--color-accent-hover',  oscurecer(brand.color_acento, 0.15));
}

function actualizarTitulo(nombreApp: string) {
  document.title = document.title.replace(/^[^|]+\|/, `${nombreApp} |`);
  if (!document.title.includes('|')) document.title = `${nombreApp} | Panel profesional`;
}

function oscurecer(hex: string, fraccion: number): string {
  const r = parseInt(hex.slice(1,3),16), g = parseInt(hex.slice(3,5),16), b = parseInt(hex.slice(5,7),16);
  const [h,s,l] = rgbToHsl(r,g,b);
  const [rn,gn,bn] = hslToRgb(h,s,Math.max(0,l-fraccion));
  const t = (n: number) => Math.round(n).toString(16).padStart(2,'0');
  return `#${t(rn)}${t(gn)}${t(bn)}`;
}

function rgbToHsl(r:number,g:number,b:number):[number,number,number]{
  r/=255;g/=255;b/=255;
  const max=Math.max(r,g,b),min=Math.min(r,g,b);
  let h=0,s=0;const l=(max+min)/2;
  if(max!==min){const d=max-min;s=l>0.5?d/(2-max-min):d/(max+min);
    switch(max){case r:h=((g-b)/d+(g<b?6:0))/6;break;case g:h=((b-r)/d+2)/6;break;case b:h=((r-g)/d+4)/6;break;}}
  return[h,s,l];
}

function hslToRgb(h:number,s:number,l:number):[number,number,number]{
  if(s===0){const v=l*255;return[v,v,v];}
  const q=l<0.5?l*(1+s):l+s-l*s,p=2*l-q;
  return[hue2rgb(p,q,h+1/3)*255,hue2rgb(p,q,h)*255,hue2rgb(p,q,h-1/3)*255];
}

function hue2rgb(p:number,q:number,t:number):number{
  if(t<0)t+=1;if(t>1)t-=1;
  if(t<1/6)return p+(q-p)*6*t;if(t<1/2)return q;if(t<2/3)return p+(q-p)*(2/3-t)*6;return p;
}
```

────────────────────────────────────────────────────────────
PASO 6 — TOKENS CSS EN index.css
────────────────────────────────────────────────────────────

Lee apps/web-professional/src/index.css.
Agrega al principio del archivo, ANTES de cualquier directiva @tailwind:

```css
/* Variables de marca — BrandContext las sobreescribe en runtime */
:root {
  --color-primary:       #16a34a;
  --color-primary-hover: #15803d;
  --color-accent:        #0ea5e9;
  --color-accent-hover:  #0284c7;
}
```

────────────────────────────────────────────────────────────
PASO 7 — TAILWIND: colores desde variables CSS
────────────────────────────────────────────────────────────

Lee apps/web-professional/tailwind.config.cjs.
Dentro de theme.extend.colors agrega:

```js
primary: {
  DEFAULT: 'var(--color-primary)',
  hover:   'var(--color-primary-hover)',
},
accent: {
  DEFAULT: 'var(--color-accent)',
  hover:   'var(--color-accent-hover)',
},
```

────────────────────────────────────────────────────────────
PASO 8 — BrandProvider en el árbol React
────────────────────────────────────────────────────────────

Lee el archivo principal de la app (App.tsx o main.tsx).
Importa BrandProvider y envuelve el contenido autenticado con él,
pasando el token activo de Keycloak:

```tsx
import { BrandProvider } from './contexts/BrandContext';

// Dentro del árbol autenticado, donde ya tienes acceso al token:
<BrandProvider token={keycloakToken}>
  {/* AppShell, rutas protegidas, etc. */}
</BrandProvider>
```

El token viene del hook de keycloak-js que ya usa el AuthProvider existente.

────────────────────────────────────────────────────────────
PASO 9 — AppShell: logo y nombre dinámico
────────────────────────────────────────────────────────────

Lee el AppShell o componente de layout (sidebar/navbar).
Importa useBrand y:
1. Logo: si brand.tiene_logo → <img src="/api/brand/logo" alt={brand.nombre_app} className="h-8 w-auto object-contain" />
         si no → mantén el ícono SVG original
2. Nombre: reemplaza el texto "NutriSmart" estático por {brand.nombre_app}

────────────────────────────────────────────────────────────
PASO 10 — Página de ajustes de marca
────────────────────────────────────────────────────────────

Crea apps/web-professional/src/pages/ajustes/MarcaPage.tsx:

```tsx
import React, { useRef, useState } from 'react';
import { useBrand } from '../../contexts/BrandContext';

const DEFAULTS = { nombre_app: 'NutriSmart', color_primario: '#16a34a', color_acento: '#0ea5e9' };
const MAX_LOGO_BYTES = 512 * 1024;
const TIPOS_ACEPTADOS = ['image/png','image/jpeg','image/webp','image/svg+xml'];

export default function MarcaPage() {
  const { brand, refrescar } = useBrand();
  // Obtener token del contexto de auth existente (usa el hook que ya existe en el proyecto)
  // Ejemplo: const { token } = useAuth();
  const token = (window as any).__kc_token__ ?? ''; // reemplaza con el hook real de tu AuthContext

  const [nombre,    setNombre]    = useState(brand.nombre_app);
  const [primario,  setPrimario]  = useState(brand.color_primario);
  const [acento,    setAcento]    = useState(brand.color_acento);
  const [logoFile,  setLogoFile]  = useState<File | null>(null);
  const [logoPreview, setLogoPreview] = useState<string | null>(brand.tiene_logo ? '/api/brand/logo' : null);
  const [guardando, setGuardando] = useState(false);
  const [error,     setError]     = useState<string | null>(null);
  const [ok,        setOk]        = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  function onLogoChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!TIPOS_ACEPTADOS.includes(file.type)) { setError('Solo PNG, JPEG, WebP y SVG.'); return; }
    if (file.size > MAX_LOGO_BYTES) { setError('El logo no puede superar 512 KB.'); return; }
    setError(null); setLogoFile(file);
    const reader = new FileReader();
    reader.onload = ev => setLogoPreview(ev.target?.result as string);
    reader.readAsDataURL(file);
  }

  async function guardar(e: React.FormEvent) {
    e.preventDefault(); setError(null); setOk(false); setGuardando(true);
    try {
      const res = await fetch('/api/brand', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ nombre_app: nombre, color_primario: primario, color_acento: acento }),
      });
      if (!res.ok) { const e = await res.json().catch(()=>({})); throw new Error(e.error ?? 'Error al guardar'); }
      if (logoFile) {
        const form = new FormData(); form.append('logo', logoFile);
        const lr = await fetch('/api/brand/logo', { method:'PUT', headers:{ Authorization:`Bearer ${token}` }, body:form });
        if (!lr.ok) { const e = await lr.json().catch(()=>({})); throw new Error(e.error ?? 'Error al subir logo'); }
      }
      await refrescar(); setOk(true);
    } catch (err: any) { setError(err.message ?? 'Error desconocido'); }
    finally { setGuardando(false); }
  }

  async function restaurarDefaults() {
    if (!confirm('¿Restaurar defaults de NutriSmart?')) return;
    setGuardando(true); setError(null); setOk(false);
    try {
      await fetch('/api/brand', { method:'PUT', headers:{'Content-Type':'application/json',Authorization:`Bearer ${token}`}, body:JSON.stringify(DEFAULTS) });
      await fetch('/api/brand/logo', { method:'DELETE', headers:{ Authorization:`Bearer ${token}` } });
      setNombre(DEFAULTS.nombre_app); setPrimario(DEFAULTS.color_primario); setAcento(DEFAULTS.color_acento);
      setLogoFile(null); setLogoPreview(null); await refrescar(); setOk(true);
    } catch (err:any) { setError(err.message ?? 'Error'); }
    finally { setGuardando(false); }
  }

  async function eliminarLogo() {
    setGuardando(true);
    try { await fetch('/api/brand/logo', { method:'DELETE', headers:{ Authorization:`Bearer ${token}` } }); setLogoFile(null); setLogoPreview(null); await refrescar(); }
    catch (err:any) { setError(err.message ?? 'Error'); }
    finally { setGuardando(false); }
  }

  return (
    <div className="max-w-2xl mx-auto p-6 space-y-8">
      <div>
        <h1 className="text-2xl font-semibold text-gray-900">Identidad visual</h1>
        <p className="text-sm text-gray-500 mt-1">Personaliza el nombre, logo y colores de la aplicación para tu clínica.</p>
      </div>
      <form onSubmit={guardar} className="space-y-6">
        {/* Nombre */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Nombre de la aplicación</label>
          <input type="text" value={nombre} onChange={e=>setNombre(e.target.value)} maxLength={80} required
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary" />
          <p className="text-xs text-gray-400 mt-1">{nombre.length}/80</p>
        </div>
        {/* Colores */}
        <div className="grid grid-cols-2 gap-4">
          {([['Color primario', primario, setPrimario],['Color de acento', acento, setAcento]] as const).map(([label, val, set]) => (
            <div key={label}>
              <label className="block text-sm font-medium text-gray-700 mb-1">{label}</label>
              <div className="flex items-center gap-2">
                <input type="color" value={val} onChange={e=>set(e.target.value)}
                  className="h-10 w-12 rounded border border-gray-300 cursor-pointer p-0.5" />
                <input type="text" value={val} onChange={e=>set(e.target.value)} pattern="^#[0-9a-fA-F]{6}$"
                  className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-primary" />
              </div>
            </div>
          ))}
        </div>
        {/* Logo */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Logo de la clínica</label>
          {logoPreview ? (
            <div className="flex items-center gap-4 mb-3">
              <img src={logoPreview} alt="Logo preview" className="h-16 w-auto max-w-[160px] object-contain rounded border border-gray-200 p-1" />
              <button type="button" onClick={eliminarLogo} disabled={guardando} className="text-sm text-red-600 hover:text-red-800 underline">Eliminar logo</button>
            </div>
          ) : (
            <div className="h-16 w-32 bg-gray-100 rounded border border-dashed border-gray-300 flex items-center justify-center text-gray-400 text-xs mb-3">Sin logo</div>
          )}
          <div className="border-2 border-dashed border-gray-300 rounded-lg p-4 text-center cursor-pointer hover:border-primary transition-colors" onClick={()=>fileRef.current?.click()}>
            <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml" onChange={onLogoChange} className="hidden" />
            <p className="text-sm text-gray-600">Haz clic para seleccionar un logo</p>
            <p className="text-xs text-gray-400 mt-1">PNG, JPEG, WebP o SVG · máx. 512 KB</p>
          </div>
        </div>
        {/* Vista previa */}
        <div className="rounded-xl border border-gray-200 overflow-hidden">
          <div className="p-4 flex items-center gap-3" style={{ backgroundColor: primario }}>
            {logoPreview
              ? <img src={logoPreview} alt="" className="h-8 w-auto object-contain" />
              : <div className="h-8 w-8 bg-white/30 rounded-lg flex items-center justify-center"><span className="text-white text-xs font-bold">N</span></div>}
            <span className="text-white font-semibold text-lg">{nombre || 'NutriSmart'}</span>
          </div>
          <div className="p-4 bg-white flex gap-2">
            <button type="button" style={{backgroundColor:primario}} className="px-4 py-2 rounded-lg text-white text-sm font-medium">Botón primario</button>
            <button type="button" style={{backgroundColor:acento}} className="px-4 py-2 rounded-lg text-white text-sm font-medium">Acento</button>
          </div>
        </div>
        {/* Feedback */}
        {error && <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-700">{error}</div>}
        {ok    && <div className="bg-green-50 border border-green-200 rounded-lg p-3 text-sm text-green-700">Configuración guardada correctamente.</div>}
        {/* Acciones */}
        <div className="flex justify-between items-center pt-2">
          <button type="button" onClick={restaurarDefaults} disabled={guardando} className="text-sm text-gray-500 hover:text-gray-700 underline">Restaurar defaults</button>
          <button type="submit" disabled={guardando} className="px-6 py-2 bg-primary hover:bg-primary-hover text-white rounded-lg text-sm font-medium transition-colors disabled:opacity-50">
            {guardando ? 'Guardando…' : 'Guardar cambios'}
          </button>
        </div>
      </form>
    </div>
  );
}
```

IMPORTANTE sobre el token en MarcaPage: después de crear el archivo, léelo y reemplaza la línea
`const token = (window as any).__kc_token__ ?? '';`
con la forma correcta de obtener el token que ya usa el resto del proyecto
(por ejemplo `const { token } = useAuth();` si ese hook existe).

────────────────────────────────────────────────────────────
PASO 11 — RUTA Y ENLACE DE NAVEGACIÓN
────────────────────────────────────────────────────────────

Lee el archivo de rutas (Router o App.tsx) y agrega la ruta:
  path: '/ajustes/marca'  →  elemento: <MarcaPage /> (solo accesible para admin_clinica)

Lee el componente de navegación lateral y agrega un enlace a /ajustes/marca
visible únicamente cuando el rol del usuario es 'admin_clinica'.

────────────────────────────────────────────────────────────
PASO 12 — MIGRACIÓN Y VERIFICACIÓN
────────────────────────────────────────────────────────────

1. Ejecuta la migración: npm run migrate (en apps/api)
2. Verifica que la tabla brand_config existe: npx tsx -e "import('./src/migrate.js')" o psql equivalente
3. Haz un GET /api/brand con el token de ana@vida.cr → debe devolver defaults
4. Haz un PUT /api/brand cambiando color_primario a #7c3aed → verifica 200
5. Verifica en la UI que el color cambió sin recargar

────────────────────────────────────────────────────────────
PASO 13 — ACTUALIZAR PRUEBAS.md
────────────────────────────────────────────────────────────

Agrega al final de docs/PRUEBAS.md la sección de tests de Rebanada 6
con los casos T6-01 a T6-09 tal como están documentados en la especificación REBANADA-06.md.

────────────────────────────────────────────────────────────
PASO 14 — COMMIT
────────────────────────────────────────────────────────────

Cuando todo compile y los tests T6-01 a T6-03 pasen manualmente:
git add apps/api/migrations/008-brand-config.sql \
        apps/api/src/routes/brand.ts \
        apps/web-professional/src/contexts/BrandContext.tsx \
        apps/web-professional/src/pages/ajustes/MarcaPage.tsx \
        apps/web-professional/src/ \
        docs/REBANADA-06.md \
        docs/PRUEBAS.md

git commit -m "R6: white-label por clínica (CLI-06)

- Tabla brand_config con UNIQUE(clinica_id)
- Endpoints GET/PUT /api/brand y GET/PUT/DELETE /api/brand/logo
- BrandContext inyecta --color-primary/--color-accent como CSS variables
- MarcaPage: ajustes de nombre, colores y logo (solo admin_clinica)
- AppShell: logo y nombre dinámico por tenant
- Logo servido públicamente sin JWT para pantalla de login"

git push origin main
