"use client";

import katex from "katex";

const LATEX_TOKEN = /(\\\[[\s\S]+?\\\]|\\\([\s\S]+?\\\)|\$\$[\s\S]+?\$\$|\$(?!\$)[^$\n]+\$)/g;

function renderMath(source: string, displayMode: boolean) {
  return katex.renderToString(source, {
    displayMode,
    output: "htmlAndMathml",
    strict: "ignore",
    throwOnError: false,
    trust: false,
  });
}

export function MathText({ text, className }: { text: string; className?: string }) {
  const parts = text.split(LATEX_TOKEN);
  return <span className={className}>
    {parts.map((part, index) => {
      const display = (part.startsWith("$$") && part.endsWith("$$"))
        || (part.startsWith("\\[") && part.endsWith("\\]"));
      const inline = (part.startsWith("$") && part.endsWith("$") && !part.startsWith("$$"))
        || (part.startsWith("\\(") && part.endsWith("\\)"));
      if (!display && !inline) return <span key={index}>{part}</span>;
      const delimiters = display ? 2 : 1;
      const formula = part.startsWith("\\")
        ? part.slice(2, -2)
        : part.slice(delimiters, -delimiters);
      const html = renderMath(formula, display);
      return <span
        key={index}
        className={display ? "latex-display" : "latex-inline"}
        dangerouslySetInnerHTML={{ __html: html }}
      />;
    })}
  </span>;
}
