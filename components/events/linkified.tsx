// 説明文: HTML は解釈せずテキストとして表示し、http(s) URL だけリンクにする（XSS 対策）
const URL_RE = /(https?:\/\/[^\s<>"'）)]+)/g;

export function Linkified({ text, className }: { text: string; className?: string }) {
  const parts = text.split(URL_RE);
  return (
    <p className={className}>
      {parts.map((p, i) =>
        i % 2 === 1 ? (
          <a key={i} href={p} target="_blank" rel="noopener noreferrer nofollow ugc" className="break-all font-semibold text-primary underline">
            {p}
          </a>
        ) : (
          p
        ),
      )}
    </p>
  );
}
