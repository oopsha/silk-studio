import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

type AiChatMarkdownProps = {
  content: string;
};

/**
 * Renders assistant/user chat content as GitHub-flavored Markdown.
 * react-markdown does not evaluate raw HTML by default (safe for chat).
 */
export function AiChatMarkdown({ content }: AiChatMarkdownProps) {
  return (
    <div className="ai-chat-markdown">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ href, children }) => (
            <a href={href} target="_blank" rel="noreferrer noopener">
              {children}
            </a>
          ),
          pre: ({ children }) => (
            <pre className="ai-chat-markdown__pre">{children}</pre>
          ),
          code: ({ className, children, ...props }) => {
            const isBlock = Boolean(className?.includes("language-"));
            if (isBlock) {
              return (
                <code className={className} {...props}>
                  {children}
                </code>
              );
            }
            return (
              <code className="ai-chat-markdown__inline-code" {...props}>
                {children}
              </code>
            );
          },
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
