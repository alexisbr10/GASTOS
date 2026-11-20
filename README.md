# Mis gastos (personal)

App personal para registrar gastos del día. Supabase (proyecto GASTOS PERSONALES) + GitHub Pages.

## Puesta en marcha
1. Crea un repo nuevo en GitHub (privado o público) y sube estos archivos.
2. Settings → Pages → Deploy from branch → main / root.
3. Supabase → Authentication → Providers → Email: desactiva **Confirm email**.
4. Abre la web, pulsa **Crear cuenta** (la primera cuenta queda como única dueña).
5. Supabase → Authentication → Sign In / Providers: desactiva **Allow new users to sign up**.
6. En el iPhone: Safari → Compartir → Añadir a pantalla de inicio.

## Apple Pay automático (iPhone)
Ajustes (⚙) → Generar clave del atajo. Luego en la app Atajos → Automatización → Transacción:
- Ejecutar inmediatamente.
- Obtener contenido de URL → POST → JSON con: token, monto (variable Monto), comercio (variable Comercio), tarjeta.

Yape no se puede automatizar en iPhone: se registra con el formulario rápido.
Compras web escribiendo el número de tarjeta y el plástico físico no pasan por Apple Pay: se registran a mano.
