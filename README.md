# 🚀 Create Backlist

[![NPM Version](https://img.shields.io/npm/v/create-backlist.svg)](https://www.npmjs.com/package/create-backlist)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

Tired of manually creating backend boilerplate every time you build a frontend? **`create-backlist`** is an intelligent CLI tool that analyzes your frontend project and automatically generates a backend with all the necessary routes and controllers, saving you hours of repetitive work.

It's not just another scaffolder; it's a **context-aware, dynamic code generator** that builds a backend tailor-made for your frontend's specific API needs.

![Demo GIF (Optional: Add a GIF of your tool in action here)](link-to-your-demo-gif.gif)

## ✨ Key Features

-   **🤖 Intelligent Code Analysis:** Scans your frontend codebase (React, Vue, etc.) using Abstract Syntax Trees (ASTs) to detect API calls (`fetch` requests).
-   **🌐 Multi-Language Support:** Generate a backend in your preferred stack. Currently supports:
    -   Node.js (with TypeScript & Express)
    -   C# (with ASP.NET Core Web API)
-   **⚡️ Fully Automated:** A single command handles everything from project scaffolding to dependency installation.
-   **🔧 Zero-Configuration:** No complex config files needed. Just run the command and answer a few simple questions.
-   ** clean Code Generation:** Creates a well-structured backend, ready for you to implement your business logic.

## 📦 Installation & Usage

No global installation needed! Just run this command inside your existing frontend project's root directory:

```bash
npm create backlist@latest
```

The tool will then guide you through an interactive setup process:

1.  **Enter a name for your backend directory:** (default: `backend`)
2.  **Select the backend stack:** (e.g., `Node.js (TypeScript, Express)`)
3.  **Enter the path to your frontend `src` directory:** (default: `src`)

That's it! The tool will analyze your code, generate the backend in a new directory, and install all the necessary dependencies.

### Example

Let's say your frontend has this API call:

```javascript
// in your React component
fetch('/api/products/123', { method: 'PUT' });
```

`create-backlist` will automatically generate a backend with a `products` controller and a `PUT` route for `products/:id`.

## 💡 How It's Different from Other Tools

| Tool                  | Approach                               | Use Case                                                    |
| --------------------- | -------------------------------------- | ----------------------------------------------------------- |
| **Express Generator** | Static Scaffolding                     | Quickly start a *new, empty* Express project.               |
| **NestJS CLI**        | Static Scaffolding & Code Generation | Start a *new, structured* NestJS project and add parts manually. |
| **`create-backlist`** | **Dynamic & Context-Aware Scaffolding** | Generate a backend that is **tailor-made** for an *existing* frontend. |

While traditional generators give you a blank canvas, `create-backlist` looks at your finished painting (the frontend) and builds the perfect frame (the backend) for it.

## 🛠️ Contributing

Contributions are what make the open-source community such an amazing place to learn, inspire, and create. Any contributions you make are **greatly appreciated**.

1.  Fork the Project
2.  Create your Feature Branch (`git checkout -b feature/AmazingFeature`)
3.  Commit your Changes (`git commit -m 'Add some AmazingFeature'`)
4.  Push to the Branch (`git push origin feature/AmazingFeature`)
5.  Open a Pull Request

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 🙏 Acknowledgements

-   [Babel](https://babeljs.io/) for the amazing AST parser.
-   [Inquirer.js](https://github.com/SBoudrias/Inquirer.js) for the interactive CLI prompts.
-   [fs-extra](https://github.com/jprichardson/node-fs-extra) for making file system operations a breeze.

---

_Built with ❤️ by [https://github.com/WAH-ISHAN])._
