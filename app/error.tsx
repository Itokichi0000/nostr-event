"use client";

import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";

export default function ErrorPage({ reset }: { error: Error; reset: () => void }) {
  return (
    <div className="mx-auto max-w-lg">
      <Alert
        tone="danger"
        title="通信に失敗しました（再試行）"
        action={
          <Button size="sm" variant="outline" onClick={reset}>
            再試行
          </Button>
        }
      >
        時間をおいてもう一度お試しください。
      </Alert>
    </div>
  );
}
