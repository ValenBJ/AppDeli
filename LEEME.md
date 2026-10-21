# McDash · Delivery Portal Rosario

App para guardar las fotos de los tickets de PedidosYa y buscarlas por número, más el pase de turno.

## Qué cambió respecto a la versión anterior

- **Fotos guardadas como archivos** (no adentro de la base). La app solo descarga las miniaturas del día que estás mirando, así que anda rápido aunque haya miles de pedidos.
- **Se borran solas a los 30 días** (se cambia en `config.js`).
- **Buscador por número** que busca en los últimos 30 días completos, no solo en lo que está cargado.
- **Login**: hace falta email y contraseña para entrar. Sin eso no se puede ver ni borrar nada.
- **El número se lee en el mismo celular** (sin clave de OCR expuesta). Siempre se puede corregir a mano.
- **Aviso de número repetido** si ese pedido ya se había cargado.
- **Botón Compartir** en cada foto: la mandás directo por WhatsApp (por ejemplo, a soporte de PeYa).
- Se sacó el botón "Borrar todo". Se borra de a un pedido desde la foto.

## Puesta en marcha (una sola vez, ~15 minutos)

### 1. Crear el proyecto en Supabase
1. Entrá a <https://supabase.com>, creá una cuenta y tocá **New project**. Región: **South America (São Paulo)**.
2. Cuando termine de crearse, andá a **SQL Editor → New query**, pegá todo el contenido de `supabase.sql` y tocá **Run**. Tiene que decir "Success".

### 2. Cerrar el registro y crear el usuario del equipo
1. **Authentication → Sign In / Providers**: desactivá **Allow new users to sign up**. *Importante:* si no lo desactivás, cualquiera podría crearse una cuenta.
2. **Authentication → Users → Add user → Create new user**: poné un email y una contraseña para el equipo (por ejemplo `delivery.portal@...`). Marcá **Auto Confirm User**.
   - Podés crear un usuario por encargado si querés saber quién cargó cada cosa.

### 3. Conectar la app
1. **Project Settings → API**: copiá **Project URL** y la clave **anon public**.
2. Abrí `config.js` y pegalas donde dice `TU-PROYECTO` y `PEGÁ-ACÁ-TU-ANON-KEY`.

### 4. Publicarla (GitHub Pages, como antes)
1. En tu repo `AppDeli` de GitHub, borrá el `index.html` viejo (o creá un repo nuevo).
2. **Add file → Upload files** y subí todos los archivos de esta carpeta: `index.html`, `app.js`, `styles.css`, `config.js`, `manifest.json`, `icono.svg`.
3. **Settings → Pages**: Source = *Deploy from a branch*, rama `main`, carpeta `/ (root)`.
4. En un minuto queda en `https://valenbj.github.io/AppDeli/`.
5. En el celular: abrila en Chrome y tocá **⋮ → Agregar a pantalla principal** para que quede como app.

> La app no funciona abriendo el `index.html` con doble clic: necesita estar publicada (o servida con un servidor local).

## Uso diario

- **Cargar pedidos**: elegí turno, tu nombre queda guardado, tocá *Sacar o elegir fotos*. La app intenta leer el número de cada ticket; revisalo y tocá **Guardar**.
- **Buscar**: escribí el número (o parte) en el buscador de arriba. Tocá la foto para verla grande, compartirla, descargarla, corregir el número o borrarla.
- **Pase de turno**: TPH obligatoria, Stock obligatoria salvo en Cierre, Rating y Calificaciones opcionales.

## Límites del plan gratis de Supabase

- 1 GB de fotos: cada pedido ocupa ~250 KB, así que entran unos 4.000 pedidos a la vez. Con el borrado a 30 días alcanza para ~130 pedidos por día.
- Si el proyecto no se usa durante 7 días seguidos, Supabase lo pausa. Se reactiva desde el panel.

## Datos de la app vieja

Los pedidos y pases que están en Firebase **no se pasan solos** a la versión nueva. Si necesitás conservarlos, se puede hacer un script para migrarlos.
