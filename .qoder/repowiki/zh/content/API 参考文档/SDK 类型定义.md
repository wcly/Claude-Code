# SDK 类型定义

<cite>
**本文档引用的文件**
- [src/entrypoints/sdk/coreTypes.ts](file://src/entrypoints/sdk/coreTypes.ts)
- [src/entrypoints/sdk/coreTypes.generated.ts](file://src/entrypoints/sdk/coreTypes.generated.ts)
- [src/entrypoints/sdk/controlTypes.ts](file://src/entrypoints/sdk/controlTypes.ts)
- [src/entrypoints/sdk/toolTypes.ts](file://src/entrypoints/sdk/toolTypes.ts)
- [src/entrypoints/sdk/runtimeTypes.ts](file://src/entrypoints/sdk/runtimeTypes.ts)
- [src/entrypoints/sdk/sdkUtilityTypes.ts](file://src/entrypoints/sdk/sdkUtilityTypes.ts)
- [src/entrypoints/sdk/settingsTypes.generated.ts](file://src/entrypoints/sdk/settingsTypes.generated.ts)
- [src/bridge/bridgeMessaging.ts](file://src/bridge/bridgeMessaging.ts)
- [src/bridge/types.ts](file://src/bridge/types.ts)
- [src/remote/sdkMessageAdapter.ts](file://src/remote/sdkMessageAdapter.ts)
- [src/types/tools.ts](file://src/types/tools.ts)
- [src/types/message.ts](file://src/types/message.ts)
- [src/types/permissions.ts](file://src/types/permissions.ts)
- [src/constants/tools.ts](file://src/constants/tools.ts)
- [src/constants/system.ts](file://src/constants/system.ts)
</cite>

## 目录
1. [简介](#简介)
2. [项目结构](#项目结构)
3. [核心组件](#核心组件)
4. [架构概览](#架构概览)
5. [详细组件分析](#详细组件分析)
6. [依赖分析](#依赖分析)
7. [性能考虑](#性能考虑)
8. [故障排除指南](#故障排除指南)
9. [结论](#结论)
10. [附录](#附录)

## 简介

本文档为 Claude Code 的 SDK 类型定义提供了全面的参考文档。该 SDK 提供了与 Claude Code 平台进行交互的完整类型安全接口，包括核心通信协议、控制消息、工具调用、运行时状态和设置管理等各个方面。

SDK 类型系统采用 TypeScript 编写，通过严格的类型约束确保开发者的代码质量和运行时安全性。系统主要分为五个核心类别：核心类型、控制类型、工具类型、运行时类型和实用类型。

## 项目结构

SDK 类型定义位于 `src/entrypoints/sdk/` 目录下，采用模块化设计，每个文件负责特定功能领域的类型定义：

```mermaid
graph TB
subgraph "SDK 核心目录"
A[src/entrypoints/sdk/] --> B[coreTypes.ts<br/>核心通信类型]
A --> C[controlTypes.ts<br/>控制消息类型]
A --> D[toolTypes.ts<br/>工具调用类型]
A --> E[runtimeTypes.ts<br/>运行时状态类型]
A --> F[sdkUtilityTypes.ts<br/>实用工具类型]
A --> G[settingsTypes.generated.ts<br/>设置类型]
A --> H[coreTypes.generated.ts<br/>生成的核心类型]
A --> I[controlSchemas.ts<br/>控制模式校验]
end
subgraph "桥接层"
J[src/bridge/] --> K[bridgeMessaging.ts<br/>消息类型守卫]
J --> L[types.ts<br/>桥接协议类型]
end
subgraph "远程通信"
M[src/remote/] --> N[sdkMessageAdapter.ts<br/>消息适配器]
end
```

**图表来源**
- [src/entrypoints/sdk/coreTypes.ts](file://src/entrypoints/sdk/coreTypes.ts)
- [src/bridge/bridgeMessaging.ts](file://src/bridge/bridgeMessaging.ts)
- [src/remote/sdkMessageAdapter.ts](file://src/remote/sdkMessageAdapter.ts)

**章节来源**
- [src/entrypoints/sdk/coreTypes.ts](file://src/entrypoints/sdk/coreTypes.ts)
- [src/entrypoints/sdk/controlTypes.ts](file://src/entrypoints/sdk/controlTypes.ts)
- [src/entrypoints/sdk/toolTypes.ts](file://src/entrypoints/sdk/toolTypes.ts)
- [src/entrypoints/sdk/runtimeTypes.ts](file://src/entrypoints/sdk/runtimeTypes.ts)
- [src/entrypoints/sdk/sdkUtilityTypes.ts](file://src/entrypoints/sdk/sdkUtilityTypes.ts)
- [src/entrypoints/sdk/settingsTypes.generated.ts](file://src/entrypoints/sdk/settingsTypes.generated.ts)

## 核心组件

### 核心通信类型

核心通信类型定义了 SDK 与 Claude Code 平台之间的基础通信协议。这些类型构成了整个 SDK 类型系统的基石，提供了类型安全的消息传递机制。

主要类型包括：
- **SDKMessage**: 所有 SDK 消息的基础类型，采用判别联合类型确保类型安全
- **ControlRequest**: 控制请求消息，用于向服务器发送控制指令
- **ControlResponse**: 控制响应消息，用于接收服务器的控制结果
- **ToolUseRequest**: 工具调用请求，用于触发各种工具操作
- **ToolUseResponse**: 工具调用响应，用于接收工具执行结果

### 控制类型

控制类型专门处理权限管理和用户交互流程。这些类型确保了对敏感操作的适当控制和用户同意。

关键类型：
- **PermissionRequest**: 权限请求类型，定义了各种权限申请的结构
- **PermissionResponse**: 权限响应类型，包含了权限决策的结果
- **UserInteractionRequest**: 用户交互请求，用于触发用户确认流程
- **SystemNotification**: 系统通知类型，用于向用户显示重要信息

### 工具类型

工具类型涵盖了所有可用工具的操作接口和参数定义。每个工具都有其特定的输入输出类型，确保工具调用的类型安全。

主要工具类型：
- **FileEditTool**: 文件编辑工具，支持文件内容修改和保存
- **BashTool**: 命令行工具，提供安全的终端命令执行能力
- **WebSearchTool**: 网络搜索工具，支持网页内容检索和分析
- **LSPTool**: 语言服务器协议工具，提供智能代码补全和诊断
- **MCPTool**: 多模型连接协议工具，支持与其他 AI 服务集成

### 运行时类型

运行时类型描述了 SDK 在运行过程中的状态和配置信息。这些类型帮助开发者理解和控制 SDK 的行为。

核心运行时类型：
- **SessionState**: 会话状态类型，跟踪当前对话的状态
- **ToolExecutionState**: 工具执行状态，记录工具调用的进度和结果
- **ErrorState**: 错误状态类型，定义了各种错误情况的表示方法
- **ProgressState**: 进度状态类型，用于显示长时间操作的进度

### 实用类型

实用类型提供了通用的类型工具和辅助类型，简化了常见类型的定义和使用。

包括：
- **AsyncResult**: 异步操作结果类型，封装了成功和失败的情况
- **Maybe**: 可选值类型，处理可能为空的值
- **Either**: 二选一类型，表示两种可能的结果之一
- **RecordOf**: 记录类型，用于键值对数据的类型约束

**章节来源**
- [src/entrypoints/sdk/coreTypes.ts](file://src/entrypoints/sdk/coreTypes.ts)
- [src/entrypoints/sdk/controlTypes.ts](file://src/entrypoints/sdk/controlTypes.ts)
- [src/entrypoints/sdk/toolTypes.ts](file://src/entrypoints/sdk/toolTypes.ts)
- [src/entrypoints/sdk/runtimeTypes.ts](file://src/entrypoints/sdk/runtimeTypes.ts)
- [src/entrypoints/sdk/sdkUtilityTypes.ts](file://src/entrypoints/sdk/sdkUtilityTypes.ts)

## 架构概览

SDK 类型系统采用分层架构设计，确保了良好的模块化和可维护性：

```mermaid
graph TB
subgraph "应用层"
A[应用程序代码]
end
subgraph "SDK 接口层"
B[核心类型接口]
C[控制类型接口]
D[工具类型接口]
E[运行时类型接口]
end
subgraph "桥接层"
F[消息类型守卫]
G[桥接协议类型]
H[消息适配器]
end
subgraph "平台层"
I[Claude Code 平台]
J[权限管理系统]
K[工具执行引擎]
L[会话管理器]
end
A --> B
A --> C
A --> D
A --> E
B --> F
C --> F
D --> F
F --> G
G --> H
H --> I
I --> J
I --> K
I --> L
```

**图表来源**
- [src/bridge/bridgeMessaging.ts](file://src/bridge/bridgeMessaging.ts)
- [src/bridge/types.ts](file://src/bridge/types.ts)
- [src/remote/sdkMessageAdapter.ts](file://src/remote/sdkMessageAdapter.ts)

### 类型层次结构

```mermaid
classDiagram
class SDKMessage {
+string type
+string request_id?
+timestamp timestamp
}
class ControlRequest {
+string type
+string request_id
+string request
+Record~string, any~ params
}
class ControlResponse {
+string type
+string request_id
+string response
+any result?
+ErrorInfo error?
}
class ToolUseRequest {
+string type
+string tool_name
+Record~string, any~ tool_input
+string tool_use_id
}
class ToolUseResponse {
+string type
+string tool_use_id
+any result?
+ErrorInfo error?
}
class PermissionRequest {
+string type
+string request_id
+string permission
+Record~string, any~ context
}
class PermissionResponse {
+string type
+string request_id
+string response
+Record~string, any~ decision
}
SDKMessage <|-- ControlRequest
SDKMessage <|-- ControlResponse
SDKMessage <|-- ToolUseRequest
SDKMessage <|-- ToolUseResponse
SDKMessage <|-- PermissionRequest
SDKMessage <|-- PermissionResponse
```

**图表来源**
- [src/entrypoints/sdk/coreTypes.ts](file://src/entrypoints/sdk/coreTypes.ts)
- [src/entrypoints/sdk/controlTypes.ts](file://src/entrypoints/sdk/controlTypes.ts)
- [src/entrypoints/sdk/toolTypes.ts](file://src/entrypoints/sdk/toolTypes.ts)

## 详细组件分析

### 核心通信协议

核心通信协议是 SDK 的基础，定义了所有消息的标准格式和传输机制。

#### 消息类型系统

```mermaid
classDiagram
class SDKMessage {
<<interface>>
+string type
+string request_id?
+timestamp timestamp
+validate() boolean
}
class TypedMessage {
<<interface>>
+string type
+validate() boolean
}
class MessageValidator {
+validate(message : SDKMessage) ValidationResult
+getType(message : SDKMessage) MessageType
+isTypedMessage(message : any) boolean
}
class ValidationResult {
+boolean isValid
+string[] errors
+string message
}
SDKMessage <|-- TypedMessage
MessageValidator --> SDKMessage : validates
MessageValidator --> ValidationResult : produces
```

**图表来源**
- [src/bridge/bridgeMessaging.ts](file://src/bridge/bridgeMessaging.ts)

#### 类型守卫实现

SDK 提供了强大的类型守卫函数，确保运行时类型检查的准确性：

```mermaid
flowchart TD
A[收到未知值] --> B{检查是否为对象}
B --> |否| C[返回 false]
B --> |是| D{检查是否存在 type 属性}
D --> |否| C
D --> |是| E{检查 type 是否为字符串}
E --> |否| C
E --> |是| F[返回 true]
G[收到 SDKMessage] --> H{检查 type 属性}
H --> |control_response| I[返回 SDKControlResponse]
H --> |control_request| J[返回 SDKControlRequest]
H --> |tool_use_request| K[返回 SDKToolUseRequest]
H --> |tool_use_response| L[返回 SDKToolUseResponse]
H --> |其他| M[返回其他类型]
```

**图表来源**
- [src/bridge/bridgeMessaging.ts](file://src/bridge/bridgeMessaging.ts)

**章节来源**
- [src/bridge/bridgeMessaging.ts](file://src/bridge/bridgeMessaging.ts)
- [src/bridge/types.ts](file://src/bridge/types.ts)

### 控制消息系统

控制消息系统专门处理权限管理和用户交互流程，确保对敏感操作的适当控制。

#### 权限管理类型

```mermaid
classDiagram
class PermissionRequest {
+string type
+string request_id
+string permission
+Record~string, any~ context
+string description
+string[] scopes
}
class PermissionDecision {
+string behavior
+string reason?
+Record~string, any~ metadata?
}
class PermissionResponse {
+string type
+string request_id
+string response
+PermissionDecision decision
}
class UserInteractionRequest {
+string type
+string request_id
+string interaction_type
+Record~string, any~ payload
+string title
+string message
}
class UserInteractionResponse {
+string type
+string request_id
+string response
+Record~string, any~ result
}
PermissionRequest --> PermissionDecision : requests
PermissionResponse --> PermissionDecision : contains
UserInteractionRequest --> UserInteractionResponse : generates
```

**图表来源**
- [src/entrypoints/sdk/controlTypes.ts](file://src/entrypoints/sdk/controlTypes.ts)
- [src/entrypoints/sdk/coreTypes.ts](file://src/entrypoints/sdk/coreTypes.ts)

#### 控制流程序列

```mermaid
sequenceDiagram
participant App as 应用程序
participant SDK as SDK 客户端
participant Bridge as 桥接层
participant Platform as Claude Code 平台
participant User as 用户
App->>SDK : 发送权限请求
SDK->>Bridge : 包装为控制请求
Bridge->>Platform : 发送权限请求
Platform->>User : 显示权限确认界面
User->>Platform : 用户确认/拒绝
Platform->>Bridge : 返回权限决策
Bridge->>SDK : 包装为控制响应
SDK->>App : 返回权限结果
Note over App,User : 权限流程完成
```

**图表来源**
- [src/bridge/bridgeMessaging.ts](file://src/bridge/bridgeMessaging.ts)
- [src/remote/sdkMessageAdapter.ts](file://src/remote/sdkMessageAdapter.ts)

**章节来源**
- [src/entrypoints/sdk/controlTypes.ts](file://src/entrypoints/sdk/controlTypes.ts)
- [src/entrypoints/sdk/coreTypes.ts](file://src/entrypoints/sdk/coreTypes.ts)

### 工具调用系统

工具调用系统提供了丰富的工具集，每个工具都有其特定的功能和类型定义。

#### 工具类型层次结构

```mermaid
classDiagram
class ToolUseRequest {
+string type
+string tool_name
+Record~string, any~ tool_input
+string tool_use_id
}
class ToolUseResponse {
+string type
+string tool_use_id
+any result?
+ErrorInfo error?
}
class FileEditToolRequest {
+string file_path
+string content
+string encoding
+boolean save?
}
class BashToolRequest {
+string command
+string working_directory?
+number timeout?
+boolean allow_background?
}
class WebSearchToolRequest {
+string query
+number max_results?
+string region?
}
class LSPToolRequest {
+string action
+Record~string, any~ params
}
ToolUseRequest <|-- FileEditToolRequest
ToolUseRequest <|-- BashToolRequest
ToolUseRequest <|-- WebSearchToolRequest
ToolUseRequest <|-- LSPToolRequest
```

**图表来源**
- [src/entrypoints/sdk/toolTypes.ts](file://src/entrypoints/sdk/toolTypes.ts)
- [src/entrypoints/sdk/coreTypes.ts](file://src/entrypoints/sdk/coreTypes.ts)

#### 工具执行流程

```mermaid
flowchart TD
A[工具调用请求] --> B[验证工具名称]
B --> C{工具是否存在}
C --> |否| D[返回错误: 工具不存在]
C --> |是| E[验证工具参数]
E --> F{参数验证通过}
F --> |否| G[返回错误: 参数无效]
F --> |是| H[执行工具]
H --> I{工具执行成功}
I --> |否| J[返回错误: 工具执行失败]
I --> |是| K[格式化工具结果]
K --> L[返回成功响应]
M[工具调用响应] --> N[检查响应状态]
N --> O{包含错误信息}
O --> |是| P[抛出异常]
O --> |否| Q[返回结果数据]
```

**图表来源**
- [src/entrypoints/sdk/toolTypes.ts](file://src/entrypoints/sdk/toolTypes.ts)
- [src/entrypoints/sdk/coreTypes.ts](file://src/entrypoints/sdk/coreTypes.ts)

**章节来源**
- [src/entrypoints/sdk/toolTypes.ts](file://src/entrypoints/sdk/toolTypes.ts)
- [src/entrypoints/sdk/coreTypes.ts](file://src/entrypoints/sdk/coreTypes.ts)

### 运行时状态管理

运行时状态管理系统跟踪 SDK 的当前状态和配置，确保应用程序能够正确响应状态变化。

#### 状态类型定义

```mermaid
classDiagram
class SessionState {
+string session_id
+string status
+string current_tool?
+ToolExecutionState tool_state?
+ErrorState error_state?
+timestamp created_at
+timestamp last_updated
}
class ToolExecutionState {
+string tool_name
+string status
+string progress_message?
+number progress_percentage?
+timestamp started_at
+timestamp completed_at?
}
class ErrorState {
+string error_code
+string message
+string severity
+Record~string, any~ details?
+timestamp occurred_at
}
class ProgressState {
+string operation
+number current_step
+number total_steps
+string status_message
+boolean is_indeterminate?
}
SessionState --> ToolExecutionState : contains
SessionState --> ErrorState : may contain
SessionState --> ProgressState : may show
```

**图表来源**
- [src/entrypoints/sdk/runtimeTypes.ts](file://src/entrypoints/sdk/runtimeTypes.ts)

#### 状态转换流程

```mermaid
stateDiagram-v2
[*] --> 初始化
初始化 --> 空闲 : 创建会话
空闲 --> 工具执行 : 调用工具
工具执行 --> 空闲 : 工具完成
工具执行 --> 错误 : 工具失败
错误 --> 空闲 : 错误处理完成
空闲 --> 关闭 : 结束会话
关闭 --> [*]
空闲 --> 权限请求 : 需要权限
权限请求 --> 空闲 : 权限已授予
权限请求 --> 拒绝 : 权限被拒绝
拒绝 --> 空闲 : 继续执行
```

**图表来源**
- [src/entrypoints/sdk/runtimeTypes.ts](file://src/entrypoints/sdk/runtimeTypes.ts)

**章节来源**
- [src/entrypoints/sdk/runtimeTypes.ts](file://src/entrypoints/sdk/runtimeTypes.ts)

### 设置类型系统

设置类型系统提供了对 SDK 配置的完整类型安全访问，包括用户偏好设置和系统配置。

#### 设置类型层次

```mermaid
classDiagram
class Settings {
+UserPreferences user_preferences
+SystemConfig system_config
+ToolConfig tool_config
+RuntimeConfig runtime_config
}
class UserPreferences {
+string theme
+string language
+boolean auto_save
+boolean notifications_enabled
+Record~string, any~ custom_settings
}
class SystemConfig {
+string api_endpoint
+string model
+number timeout_ms
+boolean debug_mode
+string log_level
}
class ToolConfig {
+Record~string, ToolSettings~ tool_settings
}
class ToolSettings {
+boolean enabled
+number max_execution_time
+string[] allowed_scopes
+Record~string, any~ custom_options
}
class RuntimeConfig {
+string session_id
+string current_model
+number max_concurrent_tools
+string[] active_features
}
Settings --> UserPreferences : contains
Settings --> SystemConfig : contains
Settings --> ToolConfig : contains
Settings --> RuntimeConfig : contains
```

**图表来源**
- [src/entrypoints/sdk/settingsTypes.generated.ts](file://src/entrypoints/sdk/settingsTypes.generated.ts)

**章节来源**
- [src/entrypoints/sdk/settingsTypes.generated.ts](file://src/entrypoints/sdk/settingsTypes.generated.ts)

## 依赖分析

SDK 类型系统具有清晰的依赖关系，确保了模块间的松耦合和高内聚。

```mermaid
graph TB
subgraph "核心依赖"
A[coreTypes.ts] --> B[bridgeMessaging.ts]
A --> C[bridgeTypes.ts]
A --> D[remoteAdapter.ts]
end
subgraph "控制依赖"
E[controlTypes.ts] --> A
E --> F[permissions.ts]
E --> G[messages.ts]
end
subgraph "工具依赖"
H[toolTypes.ts] --> A
H --> I[tools.ts]
H --> J[constants.ts]
end
subgraph "运行时依赖"
K[runtimeTypes.ts] --> A
K --> L[message.ts]
K --> M[status.ts]
end
subgraph "实用工具依赖"
N[sdkUtilityTypes.ts] --> A
N --> O[types.ts]
N --> P[utils.ts]
end
subgraph "生成类型依赖"
Q[generated.ts] --> A
Q --> R[coreTypes.ts]
end
```

**图表来源**
- [src/entrypoints/sdk/coreTypes.ts](file://src/entrypoints/sdk/coreTypes.ts)
- [src/entrypoints/sdk/controlTypes.ts](file://src/entrypoints/sdk/controlTypes.ts)
- [src/entrypoints/sdk/toolTypes.ts](file://src/entrypoints/sdk/toolTypes.ts)
- [src/entrypoints/sdk/runtimeTypes.ts](file://src/entrypoints/sdk/runtimeTypes.ts)
- [src/entrypoints/sdk/sdkUtilityTypes.ts](file://src/entrypoints/sdk/sdkUtilityTypes.ts)
- [src/entrypoints/sdk/settingsTypes.generated.ts](file://src/entrypoints/sdk/settingsTypes.generated.ts)

### 类型转换规则

SDK 定义了严格的类型转换规则，确保不同类型之间的安全转换：

1. **消息类型转换**: 所有消息必须通过类型守卫验证后才能转换为目标类型
2. **工具参数转换**: 工具调用参数必须符合预定义的接口约束
3. **权限决策转换**: 权限决策必须包含必要的元数据和验证信息
4. **错误类型转换**: 错误信息必须包含适当的错误码和描述

### 验证逻辑

SDK 实现了多层次的验证逻辑：

```mermaid
flowchart TD
A[输入数据] --> B[基本类型验证]
B --> C{类型检查通过}
C --> |否| D[返回类型错误]
C --> |是| E[结构完整性验证]
E --> F{结构验证通过}
F --> |否| G[返回结构错误]
F --> |是| H[业务规则验证]
H --> I{业务验证通过}
I --> |否| J[返回业务错误]
I --> |是| K[验证通过]
L[输出数据] --> M[序列化验证]
M --> N{序列化成功}
N --> |否| O[返回序列化错误]
N --> |是| P[输出最终结果]
```

**图表来源**
- [src/bridge/bridgeMessaging.ts](file://src/bridge/bridgeMessaging.ts)

**章节来源**
- [src/bridge/bridgeMessaging.ts](file://src/bridge/bridgeMessaging.ts)
- [src/bridge/types.ts](file://src/bridge/types.ts)

## 性能考虑

SDK 类型系统在设计时充分考虑了性能优化：

### 内存管理
- 使用只读类型定义减少内存分配
- 实现类型缓存机制避免重复验证
- 采用惰性加载策略延迟初始化大型类型

### 类型检查优化
- 实现增量类型检查避免全量验证
- 使用编译时类型推导减少运行时开销
- 优化类型守卫函数的执行效率

### 并发处理
- 支持异步类型验证操作
- 实现类型验证的并发执行
- 提供类型验证的超时机制

## 故障排除指南

### 常见类型错误

1. **类型不匹配错误**: 确保传入的参数类型与期望类型完全一致
2. **缺少必需字段**: 检查所有必需字段是否都已提供
3. **枚举值错误**: 确保枚举值在允许的范围内
4. **时间戳格式错误**: 验证时间戳的格式和有效性

### 调试技巧

1. **启用调试模式**: 在开发环境中启用详细的类型检查日志
2. **使用类型断言**: 在必要时使用类型断言进行调试
3. **检查类型守卫**: 验证类型守卫函数的正确性
4. **单元测试覆盖**: 编写针对类型定义的单元测试

**章节来源**
- [src/entrypoints/sdk/coreTypes.ts](file://src/entrypoints/sdk/coreTypes.ts)
- [src/entrypoints/sdk/controlTypes.ts](file://src/entrypoints/sdk/controlTypes.ts)

## 结论

Claude Code 的 SDK 类型定义系统提供了完整、类型安全的接口，支持复杂的 AI 助手交互场景。通过精心设计的类型层次结构和严格的验证机制，SDK 确保了开发者的代码质量和运行时安全性。

该类型系统的主要优势包括：
- 完整的类型安全保障
- 清晰的模块化设计
- 强大的扩展性
- 优秀的性能表现
- 详细的错误处理机制

随着 Claude Code 平台的发展，SDK 类型系统将继续演进，为开发者提供更好的类型安全体验。

## 附录

### 版本兼容性

SDK 类型系统遵循语义化版本控制，主要版本变更包括：
- **主要版本更新**: 可能包含破坏性变更，需要重新编写代码
- **次要版本更新**: 添加新功能但保持向后兼容
- **修订版本更新**: 修复 bug 和小的改进

### 废弃类型和迁移指南

当某些类型被标记为废弃时，开发者应该：
1. 查看废弃通知和替代方案
2. 更新代码以使用新的类型定义
3. 测试代码以确保功能正常
4. 移除废弃类型的使用

### 最佳实践

1. **类型优先**: 始终优先使用类型安全的 API
2. **错误处理**: 实现完善的错误处理机制
3. **性能优化**: 利用 SDK 提供的性能优化特性
4. **测试覆盖**: 编写全面的单元测试和集成测试
5. **文档维护**: 保持代码注释和文档的最新状态