# Academic Research Assistant

myAgent is a learning laboratory for building an Academic Research Assistant. Its purpose is to develop Agent foundations through small experiments, then combine them into evidence-grounded literature discovery, paper reading, and research synthesis.

## Language

**Agent Runtime**:
The domain-neutral foundation that coordinates a model, Model Context, Tools, and execution rules.
_Avoid_: Assistant, domain agent

**Personal Agent**:
An owner-facing agent formed by combining the Agent Runtime with a Profile and selected Capabilities.
_Avoid_: Runtime, base

**Academic Research Assistant**:
A Personal Agent focused on discovering Papers, reading research material, and producing answers grounded in traceable Evidence.
_Avoid_: Generic chatbot, paper search tool

**Profile**:
The identity, instructions, permissions, and Capability selection that define one Personal Agent.
_Avoid_: System prompt, persona

**Capability**:
A reusable, domain-focused unit of knowledge access, Tools, rules, and success criteria.
_Avoid_: Tool, feature, agent

**Tool**:
A callable contract through which the Agent Runtime observes or changes something outside the model.
_Avoid_: Capability, plugin

**Research Task**:
A concrete research goal such as finding Papers, explaining one Paper, or comparing Evidence across Papers.
_Avoid_: Prompt, chat

**Paper**:
A scholarly work together with its identity, metadata, full text when available, and cited sources.
_Avoid_: Web page, chunk, search result

**Evidence**:
A source-backed passage, result, or claim used to support an answer to a Research Task.
_Avoid_: Model opinion, unsupported summary

**Citation**:
A traceable reference connecting an answer or claim to its source Paper or web source.
_Avoid_: URL mention, search snippet

**Knowledge Source**:
An external collection of reference material used to ground answers, such as a Literature Corpus or a website.
_Avoid_: Memory

**Literature Corpus**:
A selected collection of Papers available for repeated retrieval and synthesis.
_Avoid_: Session History, Memory

**Paper Library**:
The locally persisted PDFs, parsed pages, metadata, and vector index used for repeated Paper retrieval.
_Avoid_: General knowledge folder, Session History

**PDF Parser**:
An internal Paper Library component that turns PDF bytes into page-numbered text before chunking and indexing.
_Avoid_: Agent Tool, OCR system

**Model Context**:
The bounded set of instructions, summaries, recent messages, retrieved Evidence, and Tool results sent in one model request.
_Avoid_: Session, Memory

**Context Compression**:
The process of deriving a smaller Model Context while preserving the complete Session History.
_Avoid_: Deleting the session, Memory

**Memory**:
Persistent, owner-specific information carried across Sessions with an explicit retention policy.
_Avoid_: Knowledge Source, conversation history

**Session**:
A bounded interaction history between the owner and the Academic Research Assistant.
_Avoid_: Memory

**Session History**:
The complete persisted event sequence for one Session, including user messages, model output, Tool calls, and Tool results.
_Avoid_: Model Context

**Run**:
One bounded execution of the Agent Loop for a single user task, identified independently from its containing Session.
_Avoid_: Session, model call

**Trace**:
The ordered, structured event record of one Run, used for observability and evaluation but never sent back as Model Context.
_Avoid_: Session History, console log, hidden reasoning

**Eval Case**:
A repeatable task plus deterministic expectations used to assess whether a matching Trace followed the intended tool path and answer constraints.
_Avoid_: Unit test, benchmark score, LLM judge
