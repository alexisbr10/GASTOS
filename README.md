# Mis gastos (personal)

App personal para registrar gastos del día. Supabase (proyecto GASTOS PERSONALES) + GitHub Pages.

## Puesta en marcha
1. GitHub Pages: Settings → Pages → rama main / root.
2. Supabase → Authentication → Providers → Email: desactiva **Allow new users to sign up** (registro solo por invitación).
3. Para dar acceso a alguien: Supabase → Authentication → Users → **Add user → Create new user** (correo + contraseña, marca *Auto Confirm User*). Le pasas el correo y la contraseña.
4. Cada persona ve solo sus propios gastos, categorías, reglas y clave de Apple Pay.
5. En el iPhone: Safari → Compartir → Añadir a pantalla de inicio.

## Apple Pay automático (iPhone)
Ajustes (⚙) → Generar clave del atajo. Luego en la app Atajos → Automatización → Transacción:
- Ejecutar inmediatamente.
- Obtener contenido de URL → POST → JSON con: token, monto (variable Monto), comercio (variable Comercio), tarjeta.

Yape no se puede automatizar en iPhone: se registra con el formulario rápido.
Compras web escribiendo el número de tarjeta y el plástico físico no pasan por Apple Pay: se registran a mano.
