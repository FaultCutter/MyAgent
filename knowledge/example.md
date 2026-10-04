# myAgent 示例知识

## 项目定位

myAgent is a learning-oriented TypeScript agent. Its current goal is to make the Agent Loop, tool calling, RAG, and context management easy to inspect and understand.

## 开发原则

每次只加入一个容易观察和验证的 Agent 概念。优先保持代码简单，不为尚未出现的需求提前引入复杂框架。

## 本地知识库

放入 `knowledge` 目录的 Markdown 和纯文本文件，会在首次 `knowledge_search` 或内容变化后的首次检索时自动同步到 Chroma。Agent 检索片段后，在回答中引用文件名和 chunk ID。
