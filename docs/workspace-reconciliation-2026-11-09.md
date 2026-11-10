# Reconciliación workspace Think4Ever (#286) vs git — 2026-11-09

Fuente: MCP Think4Ever (`get_file_tree`, `read_file`, folder 319), comparado contra `a1a35bc` (PR #26) y `origin/main` (`c97e822`, PR #27).

- 30 de 43 archivos de código coinciden exactamente con `a1a35bc` → **PR #27 no está desplegado**.
- 13 archivos tienen ediciones directas en el workspace que **no existen en ninguna rama de git**:

| Archivo | Workspace | a1a35bc | main | Contenido observado |
|---|---|---|---|---|
| lib/campaignFunnel.js | 46,906 | 27,868 | 27,868 | `buildExecutiveFunnel` (funnel 7 etapas, semáforo 90/60, activación 14d sobre account_verified) |
| lib/executive.js | 42,573 | 41,592 | 48,045 | arma `executiveFunnel` por país |
| lib/executiveView.js | 40,010 | 36,424 | 36,424 | cambios en vista ejecutiva |
| lib/msauth.js | 15,954 | 15,638 | 15,638 | ajustes Sign in with Microsoft (hay rama `fix/restore-microsoft-sign-in`) |
| lib/targets.js | 8,437 | 8,104 | 8,104 | nuevas claves de target (p. ej. `verified_signups`, `activated`) |
| public/css/app.css | 59,812 | 55,441 | 55,441 | estilos funnel/health |
| public/js/views/executive.js | 27,760 | 23,924 | 18,347 | North-star KPIs, Investment, funnel 7 etapas, “Cuentas verificadas vs goal” |
| public/js/views/overview.js | 20,203 | 19,449 | 4,432 | hero “Cuentas creadas”, KPIs, funnel 3–7, países, Clarity |
| public/js/views/targets.js | 26,903 | 26,830 | 26,830 | menor |
| public/js/api.js | 8,871 | 1,532 | 1,532 | `A.metrics` (DEFS, health, countryRows) |
| public/js/app.js | 33,341 | 30,912 | 31,694 | `D.verified*` (identity_cohort), `D.execAccounts` |
| public/js/assistant.js | 11,814 | 12,847 | 13,443 | contexto “Cuentas creadas/verificadas” |
| public/login.html | 5,215 | 2,865 | 2,865 | login Microsoft |

Riesgo: un deploy desde `main` borra estas ediciones; mantenerlas deja PR #27 sin aplicar.
“Cuentas verificadas” no tiene datos en producción: requiere `identity_cohort`, que exige `IDENTITY_HMAC_KEY` (no configurada) o `ph_verified_accounts`, que el conector no emite.

Decisión pendiente (dueño del workspace / Guti): commitear el workspace a una rama (`think4ever DEV commit`), y luego decidir qué conservar frente a PR #27 antes de cualquier deploy.
