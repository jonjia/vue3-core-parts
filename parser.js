const TextModes = {
  DATA: "DATA",
  RCDATA: "RCDATA",
  RAWTEXT: "RAWTEXT",
  CDATA: "CDATA",
};

function parse(str) {
  const context = {
    source: str,
    mode: TextModes.DATA,
    advanceBy(num) {
      context.source = context.source.slice(num);
    },
    advanceSpaces() {
      const match = /^[\t\r\n\f ]+/.exec(context.source);
      if (match) {
        context.advanceBy(match[0].length);
      }
    },
  };

  const nodes = parseChildren(context, []);

  return {
    type: "Root",
    children: nodes,
  };
}

function parseChildren(context, ancestors) {
  let nodes = [];
  const { mode, source } = context;

  while (!isEnd(context, ancestors)) {
    let node;
    if (mode === TextModes.DATA || mode === TextModes.RCDATA) {
      if (mode === TextModes.DATA && source[0] === "<") {
        if (source[1] === "!") {
          if (source.startsWith("<!--")) {
            node = parseComment(context);
          } else if (source.startsWith("<![CDATA[")) {
            node = parseCDATA(context, ancestors);
          }
        } else if (source[1] === "/") {
          console.error("无效的结束标签");
          continue;
        } else if (/[a-z]/i.test(source[1])) {
          node = parseElement(context, ancestors);
        }
      } else if (source.startsWith("{{")) {
        node = parseInterpolation(context);
      }

      if (!node) {
        node = parseText(context);
      }
    }
    nodes.push(node);
  }

  return nodes;
}

function isEnd(context, ancestors) {
  if (!context.source) return true;

  for (let i = ancestors.length - 1; i >= 0; i--) {
    if (context.source.startsWith(`</${ancestors[i].tag}>`)) {
      return true;
    }
  }
}

function parseElement(context, ancestors) {
  const element = parseTag(context);
  if (element.isSelfClosing) {
    return element;
  }

  if (element.tag === "textarea" || element.tag === "title") {
    context.mode = TextModes.RCDATA;
  } else if (/style|xmp|iframe|noembed|noframes|noscript/.test(element.tag)) {
    context.mode = TextModes.RAWTEXT;
  } else {
    context.mode = TextModes.DATA;
  }

  ancestors.push(element);
  element.children = parseChildren(context, ancestors);
  ancestors.pop();

  if (context.source.startsWith(`</${element.tag}>`)) {
    parseTag(context, "end");
  } else {
    console.error(`${element.tag} 标签缺少闭合标签`);
  }

  return element;
}

function parseTag(context, type = "start") {
  const { advanceBy, advanceSpaces } = context;

  const match =
    type === "start"
      ? /^<([a-z][^\t\r\n\f />]*)/i.exec(context.source)
      : /^<\/([a-z][^\t\r\n\f />]*)/i.exec(context.source);

  const tag = match[1];
  advanceBy(match[0].length);
  advanceSpaces();

  const props = parseAttributes(context);

  const isSelfClosing = context.source.startsWith("/>");
  advanceBy(isSelfClosing ? 2 : 1);

  return {
    type: "Element",
    tag,
    props,
    children: [],
    isSelfClosing,
  };
}

function parseAttributes(context) {
  const { advanceBy, advanceSpaces } = context;

  const props = [];

  while (!context.source.startsWith(">") && !context.source.startsWith("/>")) {
    const match = /^[^\t\r\n\f />][^\t\r\n\f />=]*/.exec(context.source);
    const name = match[0];
    advanceBy(name.length);
    advanceSpaces();
    advanceBy(1);
    advanceSpaces();

    let value = "";

    const quote = context.source[0];
    const isQuoted = quote === "'" || quote === '"';

    if (isQuoted) {
      advanceBy(1);
      const endQuoteIndex = context.source.indexOf(quote);
      if (endQuoteIndex > -1) {
        value = context.source.slice(0, endQuoteIndex);
        advanceBy(value.length);
        advanceBy(1);
      } else {
        console.log("缺少引号");
      }
    } else {
      const match = /^[^\t\r\n\f >]+/.exec(context.source);
      value = match[0];
      advanceBy(value.length);
    }

    advanceSpaces();

    props.push({
      type: "Attribute",
      name,
      value,
    });
  }

  return props;
}

function parseText(context) {
  let endIndex = context.source.length;

  const ltIndex = context.source.indexOf("<");
  const delimiterIndex = context.source.indexOf("{{");

  if (ltIndex > -1 && ltIndex > delimiterIndex) {
    endIndex = ltIndex;
  }

  if (delimiterIndex > -1 && delimiterIndex < ltIndex) {
    endIndex = delimiterIndex;
  }
  const content = context.source.slice(0, endIndex);

  context.advanceBy(content.length);

  return {
    type: "Text",
    content: decodeHtml(content),
  };
}

const namedCharacterRefrences = {
  gt: ">",
  "gt;": ">",
  lt: "<",
  "lt;": "<",
  "ltcc;": "⪦",
};

function decodeHtml(rawText, asAttr = false) {
  let offset = 0;
  const end = rawText.length;

  let decodedText = "";
  let maxCRNameLength = 0;

  function advance(length) {
    offset += length;
    rawText = rawText.slice(length);
  }

  while (offset < end) {
    console.log(rawText);
    const head = /&(?:#x)?/i.exec(rawText);

    if (!head) {
      const remaining = end - offset;
      decodedText += rawText.slice(0, remaining);
      advance(remaining);
      break;
    }

    decodedText += rawText.slice(0, head.index);
    advance(head.index);

    if (head[0] === "&") {
      let name = "";
      let value;
      if (/[0-9a-z]/i.test(rawText[1])) {
        if (!maxCRNameLength) {
          maxCRNameLength = Object.keys(namedCharacterRefrences).reduce(
            (max, name) => Math.max(max, name.length),
            0
          );
        }

        for (let length = maxCRNameLength; !value && length > 0; --length) {
          name = rawText.substr(1, length);
          value = namedCharacterRefrences[name];
        }

        if (value) {
          const semi = name.endsWith(";");
          if (
            asAttr &&
            !semi &&
            /[=a-z0-9]/i.test(rawText[name.length + 1] || "")
          ) {
            decodedText += "&" + name;
            advance(1 + name.length);
          } else {
            decodedText += value;
            advance(1 + name.length);
          }
        } else {
          decodedText += "&" + name;
          advance(1 + name.length);
        }
      } else {
        const hex = head[0] === "&#x";
        const pattern = hex ? /^&#x([0-9a-f]+);?/i : /^&#([0-9]+);?/;
        const body = pattern.exec(rawText);

        if (body) {
          let cp = Number.parseInt(body[1], hex ? 16 : 10);
          if (cp === 0) {
            cp = 0xfffd;
          } else if (cp > 0x10ffff) {
            cp = 0xfffd;
          } else if (cp >= 0xd800 && cp <= 0xdfff) {
            cp = 0xfffd;
          } else if (
            (cp >= 0xfdd0 && cp <= 0xfdef) ||
            (cp & 0xfffe) === 0xfffe
          ) {
          } else if (
            (cp >= 0x01 && cp <= 0x08) ||
            cp === 0x0b ||
            (cp >= 0x0d && cp < 0x1f) ||
            (cp >= 0x7f && cp <= 0x9f)
          ) {
          }

          decodedText += String.fromCodePoint(cp);
          advance(body[0].length);
        } else {
          decodedText += head[0];
          advance(head[0].length);
        }
      }
    }
  }

  return decodedText;
}

function parseInterpolation(context) {
  const { advanceBy } = context;
  advanceBy("{{".length);
  const closeIndex = context.source.indexOf("}}");
  if (closeIndex < 0) {
    console.error("插值缺少限定符");
  }

  const content = context.source.slice(0, closeIndex);
  advanceBy(content.length);
  advanceBy("}}".length);

  return {
    type: "Interpolation",
    content: {
      type: "Expression",
      content: decodeHtml(content),
    },
  };
}

function parseComment(context) {
  const { advanceBy } = context;
  advanceBy("<!--".length);
  const closeIndex = context.source.indexOf("-->");
  const content = context.source.slice(0, closeIndex);
  advanceBy(content.length);
  advanceBy("-->".length);

  return {
    type: "Comment",
    content,
  };
}

console.dir(
  parse(
    '<div :id="foo" v-show="display" @click="handler" v-on:mouseover="onMouseOver"  >{{ bar }}<!-- Comments --></div>'
  ),
  { depth: 10 }
);
