const State = {
  initial: 1,
  tagOpen: 2,
  tagName: 3,
  tagEnd: 4,
  text: 5,
  tagEndName: 6,
};

function isAlpha(char) {
  return (char >= "a" && char <= "z") || (char >= "A" && char <= "Z");
}

function tokenize(str) {
  let currentState = State.initial;

  const chars = [];
  const tokens = [];

  while (str) {
    const char = str[0];
    switch (currentState) {
      case State.initial:
        if (char === "<") {
          currentState = State.tagOpen;
        } else if (isAlpha(char)) {
          currentState = State.text;
          chars.push(char);
        }
        str = str.slice(1);
        break;
      case State.tagOpen:
        if (char === "/") {
          currentState = State.tagEnd;
        } else if (isAlpha(char)) {
          currentState = State.tagName;
          chars.push(char);
        }
        str = str.slice(1);
        break;
      case State.tagName:
        if (char === ">") {
          currentState = State.initial;
          tokens.push({
            type: "tag",
            name: chars.join(""),
          });
          chars.length = 0;
        } else if (isAlpha(char)) {
          chars.push(char);
        }
        str = str.slice(1);
        break;
      case State.tagEnd:
        if (isAlpha(char)) {
          currentState = State.tagEndName;
          chars.push(char);
          str = str.slice(1);
        }
        break;
      case State.text:
        if (isAlpha(char)) {
          chars.push(char);
        } else if (char === "<") {
          currentState = State.tagOpen;
          tokens.push({
            type: "text",
            content: chars.join(""),
          });
          chars.length = 0;
        }
        str = str.slice(1);
        break;
      case State.tagEndName:
        if (char === ">") {
          currentState = State.initial;
          tokens.push({
            type: "tagEnd",
            name: chars.join(""),
          });
          chars.length = 0;
        } else if (isAlpha(char)) {
          chars.push(char);
        }
        str = str.slice(1);
        break;
    }
  }

  return tokens;
}

function parse(tokens) {
  const root = {
    type: "Root",
    children: [],
  };

  const elementStack = [root];

  while (tokens.length) {
    const parent = elementStack[elementStack.length - 1];
    const t = tokens[0];
    switch (t.type) {
      case "tag": {
        const element = {
          type: "Element",
          tag: t.name,
          children: [],
        };
        parent.children.push(element);
        elementStack.push(element);
        break;
      }

      case "text": {
        const element = {
          type: "Text",
          content: t.content,
        };
        parent.children.push(element);
        break;
      }
      case "tagEnd": {
        elementStack.pop();
        break;
      }
    }
    tokens.shift();
  }

  return root;
}

function dump(node, indent = 0) {
  const type = node.type;
  const desc =
    node.type === "Root"
      ? ""
      : node.type === "Element"
      ? node.tag
      : node.content;

  console.log(`${"-".repeat(indent)}${type}: ${desc}`);

  node.children?.forEach((n) => {
    dump(n, indent + 2);
  });
}

function traverseNode(ast, context) {
  context.currentNode = ast;

  const exitFns = [];
  const transforms = context.nodeTransforms;
  for (let i = 0; i < transforms.length; i++) {
    const onExit = transforms[i](context.currentNode, context);
    if (onExit) {
      exitFns.push(onExit);
    }
    if (!context.currentNode) return;
  }

  const children = context.currentNode.children;
  if (children) {
    for (let i = 0; i < children.length; i++) {
      context.parent = context.currentNode;
      context.childIndex = i;
      traverseNode(children[i], context);
    }
  }

  let i = exitFns.length;
  while (i--) {
    exitFns[i]();
  }
}

function transformRoot(node) {
  return () => {
    if (node.type !== "Root") {
      return;
    }

    const vnodeJSAST = node.children[0].jsNode;
    node.jsNode = {
      type: "FunctionDecl",
      id: { type: "Identifier", name: "render" },
      params: [],
      body: [
        {
          type: "ReturnStatement",
          return: vnodeJSAST,
        },
      ],
    };
  };
}

function transformElement(node, context) {
  return () => {
    if (node.type !== "Element") {
      return;
    }

    const callExp = createCallExpression("h", [createStringLiteral(node.tag)]);
    if (node.children.length === 1) {
      callExp.arguments.push(node.children[0].jsNode);
    } else {
      callExp.arguments.push(
        createArrayExpression(node.children.map((c) => c.jsNode))
      );
    }

    node.jsNode = callExp;
  };
}

function transformText(node, context) {
  if (node.type !== "Text") {
    return;
  }

  node.jsNode = createStringLiteral(node.content);
}

function transform(ast) {
  const context = {
    currentNode: null,
    childIndex: 0,
    parent: null,
    replaceNode(node) {
      context.parent.children[context.childIndex] = node;
      context.currentNode = node;
    },
    removeNode() {
      if (context.parent) {
        context.parent.children.splice(context.childIndex, 1);
        context.currentNode = null;
      }
    },
    nodeTransforms: [transformRoot, transformElement, transformText],
  };
  traverseNode(ast, context);
}

function createStringLiteral(value) {
  return {
    type: "StringLiteral",
    value,
  };
}

function createIdentifier(name) {
  return {
    type: "Identifier",
    name,
  };
}

function createArrayExpression(elements) {
  return {
    type: "ArrayExpression",
    elements,
  };
}

function createCallExpression(callee, arguments) {
  return {
    type: "CallExpression",
    callee: createIdentifier(callee),
    arguments,
  };
}

function generate(node) {
  const context = {
    code: "",
    push(code) {
      context.code += code;
    },
    currentIndent: 0,
    newline() {
      context.code += "\n" + "  ".repeat(context.currentIndent);
    },
    indent() {
      context.currentIndent++;
      context.newline();
    },
    deIndent() {
      context.currentIndent--;
      context.newline();
    },
  };

  genNode(node, context);

  return context.code;
}

function genNode(node, context) {
  switch (node.type) {
    case "FunctionDecl":
      genFunctionDecl(node, context);
      break;
    case "ReturnStatement":
      genReturnStatement(node, context);
      break;
    case "CallExpression":
      genCallExpression(node, context);
      break;
    case "StringLiteral":
      genStringLiteral(node, context);
      break;
    case "ArrayExpression":
      genArrayExpression(node, context);
      break;
  }
}

function genFunctionDecl(node, context) {
  const { push, indent, deIndent } = context;
  push(`function ${node.id.name} `);
  push("(");
  genNodeList(node.params, context);
  push(") ");
  push("{");
  indent();
  node.body.forEach((n) => genNode(n, context));
  deIndent();
  push("}");
}

function genReturnStatement(node, context) {
  const { push } = context;
  push("return ");
  genNode(node.return, context);
}

function genCallExpression(node, context) {
  const { push } = context;
  push(`${node.callee.name}(`);
  const args = node.arguments;
  genNodeList(args, context);
  push(")");
}

function genStringLiteral(node, context) {
  const { push } = context;
  push(`'${node.value}'`);
}

function genArrayExpression(node, context) {
  const { push } = context;
  push("[");
  genNodeList(node.elements, context);
  push("]");
}

function genNodeList(nodes, context) {
  const { push } = context;
  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i];
    genNode(node, context);
    if (i < nodes.length - 1) {
      push(", ");
    }
  }
}

function compile(tokens) {
  const ast = parse(tokens);
  transform(ast);
  const code = generate(ast.jsNode);
  return code;
}

const tokens = tokenize("<div><p>Vue</p><p>Template</p></div>");
const code = compile(tokens);
console.log(code);

function render() {
  return h("div", [h("p", "Vue"), h("p", "Template")]);
}
