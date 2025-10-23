# Claude Code Session Diff

Una extensión de VS Code que te permite rastrear y visualizar todos los cambios de archivos realizados durante una sesión de Claude Code.

## Características

- 📊 **Tracking automático**: Lee los archivos `.jsonl` de sesión de Claude Code para identificar todos los cambios
- 🔍 **Búsqueda de cambios**: Encuentra rápidamente qué archivos fueron modificados y cuándo
- 📝 **Visualización de diffs**: Usa la API nativa de VS Code (`vscode.diff`) para mostrar diferencias
- ⏱️ **Historial temporal**: Ve los cambios en orden cronológico
- 📦 **Resumen de sesión**: Vista general de todos los archivos modificados

## Comandos

### `Claude Code: Show Session Changes`
Muestra todos los cambios de archivos de la sesión actual de Claude Code. Abre un menú interactivo donde puedes seleccionar cualquier cambio para ver el diff.

### `Claude Code: Show Recent Diffs`
Muestra los cambios más recientes (configurable) con un resumen en el panel de salida y un menú de selección.

### `Claude Code: Show Changes Summary`
Genera un resumen textual de todos los cambios agrupados por archivo en el panel de salida.

## Cómo funciona

La extensión lee los archivos de sesión de Claude Code ubicados en:
- `~/.claude/projects/`
- `~/.claude-gpt5/projects/`

Estos archivos `.jsonl` contienen un registro completo de todas las interacciones, incluyendo:
- Operaciones `Edit`: cambios puntuales con `old_string` y `new_string`
- Operaciones `Write`: escritura completa de archivos

La extensión parsea estos eventos y extrae los cambios para mostrarlos usando la API de diff de VS Code.

## Configuración

```json
{
  "claudeCodeDiff.sessionPath": "",
  "claudeCodeDiff.maxChangesToShow": 50
}
```

- `sessionPath`: Path personalizado a las sesiones (auto-detectado si vacío)
- `maxChangesToShow`: Número máximo de cambios a mostrar

## Uso

1. Abre un workspace donde hayas usado Claude Code
2. Abre la paleta de comandos (`Ctrl+Shift+P` / `Cmd+Shift+P`)
3. Busca "Claude Code" para ver los comandos disponibles
4. Selecciona el comando deseado

## Estructura del proyecto

```
src/
├── types/
│   └── session-events.ts      # Tipos TypeScript para eventos de sesión
├── parsers/
│   └── session-parser.ts      # Parser de archivos .jsonl
├── diff-tracker/
│   └── diff-tracker.ts        # Gestor de diffs con VS Code API
└── extension.ts               # Punto de entrada de la extensión
```

## Inspiración

Basado en los scripts `claudehooks` que ya procesan archivos de sesión de Claude Code para otros propósitos como generación de supervisores y análisis de sesiones.

## Desarrollo

```bash
npm install
npm run compile
```

Presiona `F5` en VS Code para ejecutar en modo debug.

## Requisitos

- VS Code 1.80.0 o superior
- Claude Code instalado y configurado
- Sesiones activas en `~/.claude/` o `~/.claude-gpt5/`

## Licencia

MIT
