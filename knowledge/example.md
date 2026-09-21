# myAgent 示例知识

## 项目定位

myAgent is a learning-oriented TypeScript agent. Its current goal is to make the Agent Loop, tool calling, RAG, and context management easy to inspect and understand.

## 开发原则

每次只加入一个容易观察和验证的 Agent 概念。优先保持代码简单，不为尚未出现的需求提前引入复杂框架。

## 本地知识库

放入 `knowledge` 目录的 Markdown 和纯文本文件可以建立 Chroma 向量索引。Agent 通过 `knowledge_search` 检索片段，并在回答中引用文件名和 chunk ID。
