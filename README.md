
# 🚀 Create Backlist CLI

[![NPM Version](https://img.shields.io/npm/v/create-backlist.svg?style=flat-square&color=blue)](https://www.npmjs.com/package/create-backlist)
[![Downloads](https://img.shields.io/npm/dt/create-backlist.svg?style=flat-square&color=green)](https://www.npmjs.com/package/create-backlist)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg?style=flat-square)](https://opensource.org/licenses/MIT)
[![Maintenance](https://img.shields.io/badge/Maintained%3F-yes-green.svg?style=flat-square)](https://github.com/WAH-ISHAN/create-backlist/graphs/commit-activity)

> **The World's First AST-Powered Polyglot Backend Generator.**

Tired of manually coding backend boilerplate? **`create-backlist`** is an intelligent CLI tool that **Reverse Engineers** your frontend code to automatically generate production-ready backends in seconds.

Unlike traditional scaffolders that use templates, it scans your live code (like `axios` or `fetch` calls) using **Abstract Syntax Trees (AST)** to build custom, context-aware backends with built-in **Docker support**.

---

## 🏗️ The Architecture (How It Works)

We don't just copy-paste. We use a sophisticated **3-Stage Compilation Process** to understand your code's logic:

```mermaid
%%{init: {'theme': 'base', 'themeVariables': { 'primaryColor': '#ffcc00', 'edgeLabelBackground':'#ffffff', 'tertiaryColor': '#f4f4f4'}}}%%
graph LR
    subgraph Input [Stage 1: Analysis]
        A[Frontend Code] -->|AST Parsing| B(Scanner Engine)
    end
    subgraph Core [Stage 2: Abstraction]
        B -->|Extracts Logic| C{Intermediate JSON Bridge}
    end
    subgraph Output [Stage 3: Generation]
        C -->|Transpiles| D[Node.js Generator]
        C -->|Transpiles| E[Python Generator]
        C -->|Transpiles| F[Java Generator]
        C -->|Transpiles| G[C# .NET Generator]
    end
    style C fill:#ff9900,stroke:#333,stroke-width:2px,color:white

```

1. **Stage 1 (Analysis):** The engine scans your frontend source code and builds an Abstract Syntax Tree to understand API intent.
2. **Stage 2 (Abstraction):** Extracted logic is converted into a universal **JSON Intermediate Representation (IR)** that acts as a "bridge" between languages.
3. **Stage 3 (Generation):** Language-specific code generators read the JSON IR and compile it into production-ready code for your chosen stack.

---

## ✨ Key Features & Innovation

| Feature | Description |
| --- | --- |
| **🤖 AST-Powered Engine** | Uses advanced static analysis to detect endpoints dynamically, not just regex matching. |
| **🌐 Polyglot Support** | One tool for multiple backend languages. <br>

<br>✅ **Node.js (Express/TS)** - *Production Ready*<br>

<br>🚀 **Python (FastAPI)** - *Beta*<br>

<br>☕ **Java (Spring Boot)** - *Beta*<br>

<br>🔷 **C# (ASP.NET Core)** - *Beta* |
| **🐳 Auto-Dockerization** | Instantly generates optimized `Dockerfile` and `docker-compose.yml` for zero-config deployment. |
| **🧠 Active Context Analysis** | Smartly prioritizes scanning the file currently open in your VS Code editor for higher accuracy on complex files. |
| **⚡ Zero-Config Boilerplate** | Generates controllers, routes, models, and configuration files automatically. |

---

## 📦 Quick Start

No global installation needed. Just run this command inside your existing frontend project's root:

```bash
npx create-backlist@latest

```

The interactive CLI will guide you:

1. **Select your Target Language:** (e.g., Node.js, Python, Java...)
2. **Name your backend folder:** (default: `backend`)
3. **Sit back and watch the magic!** 🪄

---

## 🗺️ Roadmap & Research Goals

This tool is an ongoing research project aimed at automating software infrastructure.

* [x] **Phase 1: Core Engine** (AST Parsing & Node.js Support) - *Completed*
* [x] **Phase 2: Polyglot Architecture** (Python, Java, C# Beta & Docker) - *Completed*
* [ ] **Phase 3: Intelligent Data Modeling** (Auto-generate Prisma/TypeORM schemas from request bodies)
* [ ] **Phase 4: Security Automation** (Auto-generate JWT auth and basic security headers)

---

## 🤝 Contributing & Feedback

This is an open-source project built for the developer community. We welcome contributions, especially for improving our Beta language generators!

* Found a bug? [Open an Issue](https://github.com/WAH-ISHAN/create-backlist/issues).
* Want to contribute? [Submit a Pull Request](https://www.google.com/search?q=https://github.com/WAH-ISHAN/create-backlist/pulls).

Give us a ⭐ on GitHub if this saved you time!

---

*Built with ❤️ for builders by [W.A.H. ISHAN](https://github.com/WAH-ISHAN).*

```

---
