# INI Config Navigator

为 INI 配置文件提供智能导航的 VS Code 扩展。

## 功能特性

- **智能跳转** - F12 跳转到配置项定义，支持多位置选择
- **悬停预览** - 鼠标悬停显示配置项完整内容
- **自动补全** - 智能提示所有可用配置项
- **多文件支持** - 支持 `.ini` `.lua` `.ts` `.txt` `.md` 文件

## 使用方法

1. **定义配置项**（`config.ini`）：
```ini
[player_unit]
name = "玩家单位"
hp = 100
```

2. **在代码中引用**（`script.lua`）：
```lua
CreateUnit("player_unit")  -- 可跳转到定义
```

3. **操作方式**：
   - `F12` 或 `Ctrl+点击` - 跳转到定义
   - 鼠标悬停 - 预览配置内容
   - 输入时 - 自动补全配置项

## 支持的引用格式

| 文件类型 | 引用格式 | 示例 |
|---------|---------|------|
| `.ini` | 配置项引用 | `player_unit` |
| `.lua` | 字符串引用 | `"player_unit"` |
| `.ts` | 字符串引用 | `"player_unit"` `'player_unit'` |
| `.txt/.md` | 直接匹配 | `player_unit` |

适用于游戏开发、配置管理等需要 INI 文件导航的项目。
