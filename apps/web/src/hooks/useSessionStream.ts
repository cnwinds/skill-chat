import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { fetchEventSource } from '@microsoft/fetch-event-source';
import { useAuthStore } from '../stores/auth-store';
import { useUiStore } from '../stores/ui-store';

export const useSessionStream = (sessionId: string | null) => {
  const token = useAuthStore((state) => state.token);
  const queryClient = useQueryClient();
  const stream = useUiStore((state) => (sessionId ? state.streams[sessionId] : undefined));
  const appendTextDelta = useUiStore((state) => state.appendTextDelta);
  const pushThinking = useUiStore((state) => state.pushThinking);
  const pushToolCall = useUiStore((state) => state.pushToolCall);
  const pushToolProgress = useUiStore((state) => state.pushToolProgress);
  const pushToolResult = useUiStore((state) => state.pushToolResult);
  const pushError = useUiStore((state) => state.pushError);
  const setStreamStatus = useUiStore((state) => state.setStreamStatus);
  const clearStreamContent = useUiStore((state) => state.clearStreamContent);
  const resetStream = useUiStore((state) => state.resetStream);

  useEffect(() => {
    if (!sessionId || !token) {
      return;
    }

    const controller = new AbortController();
    resetStream(sessionId);
    setStreamStatus(sessionId, 'connecting');

    void fetchEventSource(`/api/sessions/${sessionId}/stream`, {
      signal: controller.signal,
      openWhenHidden: true,
      headers: {
        Authorization: `Bearer ${token}`,
      },
      async onopen(response) {
        if (!response.ok) {
          throw new Error(`Stream open failed: ${response.status}`);
        }
        setStreamStatus(sessionId, 'open');
      },
      onmessage(event) {
        if (!event.event) {
          return;
        }

        const payload = event.data ? JSON.parse(event.data) as Record<string, unknown> : {};

        if (event.event === 'text_delta') {
          appendTextDelta(sessionId, String(payload.content ?? ''));
          return;
        }

        if (event.event === 'thinking') {
          pushThinking(sessionId, {
            id: event.id || crypto.randomUUID(),
            sessionId,
            kind: 'thinking',
            content: String(payload.message ?? '处理中'),
            createdAt: new Date().toISOString(),
          });
          return;
        }

        if (event.event === 'tool_start') {
          const skill = (payload.skill as { name?: string; status?: string } | undefined) ?? {};
          pushToolCall(sessionId, {
            id: event.id || crypto.randomUUID(),
            sessionId,
            kind: 'tool_call',
            callId: typeof payload.callId === 'string' ? payload.callId : undefined,
            skill: skill.name ?? 'tool',
            arguments: typeof payload.arguments === 'object' && payload.arguments
              ? payload.arguments as Record<string, unknown>
              : {},
            meta: typeof payload.meta === 'object' && payload.meta
              ? payload.meta as Record<string, unknown>
              : undefined,
            createdAt: new Date().toISOString(),
          });
          return;
        }

        if (event.event === 'tool_progress') {
          const skill = (payload.skill as { name?: string; status?: string } | undefined) ?? {};
          pushToolProgress(sessionId, {
            id: event.id || crypto.randomUUID(),
            sessionId,
            kind: 'tool_progress',
            callId: typeof payload.callId === 'string' ? payload.callId : undefined,
            skill: skill.name ?? 'tool',
            message: String(payload.message ?? '任务执行中'),
            percent: typeof payload.percent === 'number' ? payload.percent : undefined,
            status: skill.status,
            meta: typeof payload.meta === 'object' && payload.meta
              ? payload.meta as Record<string, unknown>
              : undefined,
            createdAt: new Date().toISOString(),
          });
          return;
        }

        if (event.event === 'tool_result') {
          const skill = (payload.skill as { name?: string; status?: string } | undefined) ?? {};
          pushToolResult(sessionId, {
            id: event.id || crypto.randomUUID(),
            sessionId,
            kind: 'tool_result',
            callId: typeof payload.callId === 'string' ? payload.callId : undefined,
            skill: skill.name ?? 'tool',
            message: String(payload.message ?? '工具执行完成'),
            content: typeof payload.content === 'string' ? payload.content : undefined,
            meta: typeof payload.meta === 'object' && payload.meta
              ? payload.meta as Record<string, unknown>
              : undefined,
            createdAt: new Date().toISOString(),
          });
          return;
        }

        if (event.event === 'file_ready') {
          void queryClient.invalidateQueries({ queryKey: ['files', sessionId] });
          void queryClient.invalidateQueries({ queryKey: ['messages', sessionId] });
          return;
        }

        if (event.event === 'error') {
          pushError(sessionId, {
            id: event.id || crypto.randomUUID(),
            sessionId,
            kind: 'error',
            message: String(payload.message ?? '处理失败'),
            createdAt: new Date().toISOString(),
          });
          return;
        }

        if (event.event === 'done') {
          void queryClient.invalidateQueries({ queryKey: ['messages', sessionId] });
          void queryClient.invalidateQueries({ queryKey: ['files', sessionId] });
          void queryClient.invalidateQueries({ queryKey: ['sessions'] });
          window.setTimeout(() => {
            clearStreamContent(sessionId);
          }, 160);
        }
      },
      onclose() {
        if (!controller.signal.aborted) {
          setStreamStatus(sessionId, 'idle');
        }
      },
      onerror(error) {
        if (controller.signal.aborted) {
          return;
        }
        setStreamStatus(sessionId, 'error', error instanceof Error ? error.message : '连接断开');
        throw error;
      },
    }).catch((error) => {
      if (!controller.signal.aborted) {
        setStreamStatus(sessionId, 'error', error instanceof Error ? error.message : '连接断开');
      }
    });

    return () => {
      controller.abort();
      setStreamStatus(sessionId, 'idle');
    };
  }, [
    appendTextDelta,
    clearStreamContent,
    pushError,
    pushThinking,
    pushToolCall,
    pushToolProgress,
    pushToolResult,
    queryClient,
    resetStream,
    sessionId,
    setStreamStatus,
    token,
  ]);

  return stream ?? {
    pendingText: '',
    transientEvents: [],
    status: 'idle' as const,
    lastError: null,
  };
};
