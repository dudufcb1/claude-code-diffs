# Guía de Uso - Claude Code Session Diff

## Instalación

### Opción 1: Desarrollo Local

1. Clona o copia este proyecto
2. Abre la carpeta en VS Code
3. Presiona `F5` para ejecutar en modo debug
4. Se abrirá una nueva ventana de VS Code con la extensión cargada

### Opción 2: Instalación desde VSIX

```bash
# Empaquetar la extensión
npm install -g @vscode/vsce
vsce package

# Instalar
code --install-extension claude-code-session-diff-0.1.0.vsix
```

## Cómo Funciona

### Arquitectura

```
┌─────────────────────────────────────────────────────────────┐
│                                                               │
│  ~/.claude/projects/ o ~/.claude-gpt5/projects/             │
│                                                               │
│  ├── -home-eduardo-proyecto/                                │
│  │   ├── session-uuid-1.jsonl  ◄─── Lee eventos             │
│  │   └── session-uuid-2.jsonl                               │
│  │                                                           │
│  └── -media-eduardo-otro-proyecto/                          │
│      └── session-uuid-3.jsonl                               │
│                                                               │
└─────────────────────────────────────────────────────────────┘
                         │
                         │ Parser
                         ▼
           ┌─────────────────────────────┐
           │   SessionParser             │
           │                             │
           │  • findClaudeInstances()    │
           │  • parseSessionFile()       │
           │  • extractFileChanges()     │
           └─────────────────────────────┘
                         │
                         │ FileChange[]
                         ▼
           ┌─────────────────────────────┐
           │   DiffTracker               │
           │                             │
           │  • showDiff()               │
           │  • showChangesQuickPick()   │
           │  • showChangesSummary()     │
           └─────────────────────────────┘
                         │
                         │ vscode.diff
                         ▼
           ┌─────────────────────────────┐
           │   VS Code Diff Editor       │
           │   (Native UI)               │
           └─────────────────────────────┘
```

### Formato de Eventos `.jsonl`

Cada línea en el archivo `.jsonl` es un evento JSON:

```json
{
  "type": "assistant",
  "timestamp": "2025-10-23T13:45:00.000Z",
  "sessionId": "uuid-here",
  "message": {
    "role": "assistant",
    "content": [
      {
        "type": "tool_use",
        "name": "Edit",
        "input": {
          "file_path": "/path/to/file.ts",
          "old_string": "const old = 'value';",
          "new_string": "const new = 'updated';"
        }
      }
    ]
  }
}
```

### Operaciones Soportadas

#### Edit (Edición puntual)
- **old_string**: Contenido antes del cambio
- **new_string**: Contenido después del cambio
- **file_path**: Ruta del archivo modificado

#### Write (Escritura completa)
- **content**: Contenido completo del archivo
- **file_path**: Ruta del archivo escrito

## Comandos

### 1. Show Session Changes

**Comando**: `Claude Code: Show Session Changes`

**Qué hace**:
1. Busca el directorio de sesiones para el workspace actual
2. Identifica el archivo `.jsonl` más reciente
3. Extrae todos los eventos `Edit` y `Write`
4. Muestra un QuickPick con todos los cambios

**Uso**:
```
Ctrl+Shift+P → "Claude Code: Show Session Changes"
```

**Output**:
```
┌────────────────────────────────────────────────┐
│ Select a file change to view diff             │
├────────────────────────────────────────────────┤
│ 📄 file.ts                                     │
│    Edit @ 2025-10-23 13:45:00                 │
│    /path/to/file.ts                           │
├────────────────────────────────────────────────┤
│ 📄 component.tsx                               │
│    Write @ 2025-10-23 13:44:00                │
│    /path/to/component.tsx                     │
└────────────────────────────────────────────────┘
```

### 2. Show Recent Diffs

**Comando**: `Claude Code: Show Recent Diffs`

**Qué hace**:
1. Lee los últimos N cambios (configurable)
2. Genera un resumen en el Output Channel
3. Muestra QuickPick para seleccionar cambio individual

**Configuración**:
```json
{
  "claudeCodeDiff.maxChangesToShow": 50
}
```

**Output Channel**:
```
═══════════════════════════════════════════════════
  Claude Code Session Changes Summary
═══════════════════════════════════════════════════

Total files modified: 5
Total changes: 12

Changes by file:

📄 /path/to/server.ts
   3 change(s)

   • Edit - 2025-10-23 13:45:23
   • Edit - 2025-10-23 13:44:15
   • Write - 2025-10-23 13:42:01

📄 /path/to/client.ts
   2 change(s)

   • Edit - 2025-10-23 13:43:00
   • Edit - 2025-10-23 13:41:30

═══════════════════════════════════════════════════
```

### 3. Show Changes Summary

**Comando**: `Claude Code: Show Changes Summary`

**Qué hace**:
- Solo muestra el resumen en Output Channel
- No abre el QuickPick
- Útil para overview rápido

## Visualización de Diffs

### VS Code Diff Editor

Cuando seleccionas un cambio, se abre el editor de diff nativo de VS Code:

```
┌─────────────────────────────────────────────────────────────┐
│ file.ts - Edit @ 2025-10-23 13:45:00                        │
├──────────────────────────┬──────────────────────────────────┤
│ BEFORE                   │ AFTER                            │
├──────────────────────────┼──────────────────────────────────┤
│ const old = 'value';     │ const new = 'updated';          │
│                          │                                  │
│ function foo() {         │ function foo() {                │
│   return old;            │   return new;                   │
│ }                        │ }                               │
└──────────────────────────┴──────────────────────────────────┘
```

### Navegación

- **←/→**: Navegar entre cambios
- **F7**: Siguiente diferencia
- **Shift+F7**: Diferencia anterior
- **Esc**: Cerrar diff

## Casos de Uso

### 1. Revisar cambios antes de commit

```bash
# En tu terminal
git status

# En VS Code
Ctrl+Shift+P → "Claude Code: Show Session Changes"

# Revisa cada cambio
# Decide qué incluir en el commit
```

### 2. Debugging: ¿Cuándo se modificó este archivo?

```bash
# En VS Code
Ctrl+Shift+P → "Claude Code: Show Recent Diffs"

# Busca el archivo en el output
# Ve todos los timestamps
```

### 3. Code Review de sesión

```bash
# Antes de hacer PR
Ctrl+Shift+P → "Claude Code: Show Changes Summary"

# Revisa el resumen completo
# Valida que todos los cambios son intencionales
```

### 4. Revertir cambio específico

```bash
# Identifica el cambio
Ctrl+Shift+P → "Claude Code: Show Session Changes"

# Ve el diff
# Copia el contenido "BEFORE"
# Revertir manualmente si es necesario
```

## Configuración Avanzada

### Personalizar path de sesiones

Si usas una instalación personalizada de Claude Code:

```json
{
  "claudeCodeDiff.sessionPath": "/custom/path/to/.claude/projects"
}
```

### Límite de cambios

Para sesiones largas, limita cuántos cambios mostrar:

```json
{
  "claudeCodeDiff.maxChangesToShow": 100
}
```

## Troubleshooting

### No encuentra sesiones

**Problema**: "No file changes found in current Claude Code session"

**Solución**:
1. Verifica que estás en un workspace usado con Claude Code
2. Confirma que existe `~/.claude/projects/` o `~/.claude-gpt5/projects/`
3. Verifica que hay archivos `.jsonl` recientes

```bash
ls -la ~/.claude/projects/
ls -la ~/.claude-gpt5/projects/
```

### Diff vacío

**Problema**: El diff se muestra vacío

**Causas**:
- El cambio fue un `Write` sin contenido previo
- El archivo fue eliminado después del cambio
- Error en el parsing del evento

**Solución**: Revisa el Output Channel para ver mensajes de error

### Sesión incorrecta

**Problema**: Muestra cambios de otra sesión

**Explicación**: La extensión usa el archivo `.jsonl` más reciente del workspace. Si hay múltiples sesiones activas, podría mostrar la incorrecta.

**Solución**:
```json
{
  "claudeCodeDiff.sessionPath": "/ruta/especifica/al/session-uuid.jsonl"
}
```

## Integración con Git

### Pre-commit hook

Puedes usar esta extensión en un hook de pre-commit:

```bash
#!/bin/bash
# .git/hooks/pre-commit

echo "Revisando cambios de Claude Code..."

# Abre VS Code con el comando
code --command claudeCodeDiff.showChangesSummary

# Espera confirmación
read -p "¿Continuar con commit? (y/n) " -n 1 -r
echo
if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    exit 1
fi
```

## Performance

### Sesiones grandes

Para archivos `.jsonl` muy grandes (>10MB):

- La extensión puede tardar unos segundos en parsear
- Se muestra un indicador de progreso
- Los cambios se cargan bajo demanda

### Optimizaciones

- Cache de sesiones parseadas (futuro)
- Streaming parsing para archivos grandes (futuro)
- Índice de cambios (futuro)

## Desarrollo

### Estructura del código

```
src/
├── types/
│   └── session-events.ts      # Interfaces TypeScript
├── parsers/
│   └── session-parser.ts      # Lógica de parsing
├── diff-tracker/
│   └── diff-tracker.ts        # UI y diff management
└── extension.ts               # Entry point
```

### Testing

```bash
# Compilar
npm run compile

# Watch mode
npm run watch

# Debug
F5 en VS Code
```

### Contribuir

1. Fork el proyecto
2. Crea una rama: `git checkout -b feature/nueva-funcionalidad`
3. Commit: `git commit -m 'Add: nueva funcionalidad'`
4. Push: `git push origin feature/nueva-funcionalidad`
5. Pull Request

## Roadmap

- [ ] Tree view sidebar con historial completo
- [ ] Filtros por tipo de cambio (Edit/Write)
- [ ] Búsqueda de cambios por contenido
- [ ] Exportar diffs a archivo
- [ ] Integración con Git blame
- [ ] Stats de sesión (archivos más modificados, etc.)
- [ ] Timeline view de cambios

## Licencia

MIT
