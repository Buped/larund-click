import { useState, useEffect } from 'react';
import { listen } from '@tauri-apps/api/event';
import { Icon, ClickMark } from './icons';

interface AgentStep {
  id: string;
  type: string;
  tool?: string;
  output?: string;
  error?: string;
}

interface OverlayState {
  active: boolean;
  status: string;
  task: string;
  steps: AgentStep[];
  askQuestion?: string;
}

export function OverlayApp() {
  const [state, setState] = useState<OverlayState>({
    active: false,
    status: 'idle',
    task: '',
    steps: [],
  });
  const [answer, setAnswer] = useState('');
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    const unlisten = listen<OverlayState>('agent-overlay-update', (event) => {
      setState(event.payload);
    });
    return () => { unlisten.then(f => f()); };
  }, []);

  async function handleAnswerSubmit() {
    const { emit } = await import('@tauri-apps/api/event');
    await emit('agent-overlay-answer', { answer });
    setAnswer('');
  }

  if (!state.active) return null;

  const currentStep = state.steps.filter(s => s.type === 'tool_call').pop();
  const currentThinking = [...state.steps].reverse().find(s => s.type === 'thinking')?.output?.trim();

  return (
    <div style={{
      position: 'fixed', bottom: 16, right: 16,
      width: 320, fontFamily: 'Inter, system-ui, sans-serif',
      filter: 'drop-shadow(0 8px 32px rgba(0,0,0,0.6))',
    }}>
      {/* Ask User popup */}
      {state.askQuestion && (
        <div style={{
          background: 'rgba(26,26,24,0.97)',
          border: '1px solid rgba(74,158,255,0.4)',
          borderRadius: 14, padding: '16px 18px',
          marginBottom: 10,
          backdropFilter: 'blur(20px)',
        }}>
          <div style={{
            display: 'flex', alignItems: 'center',
            gap: 8, marginBottom: 12,
          }}>
            <ClickMark size={18} radius={6} />
            <span style={{ fontSize: 13, fontWeight: 600, color: '#ECE8E3' }}>
              Click needs info
            </span>
          </div>
          <p style={{
            fontSize: 12.5, color: '#8A8783',
            lineHeight: 1.55, marginBottom: 12,
            whiteSpace: 'pre-wrap',
          }}>
            {state.askQuestion}
          </p>
          <input
            value={answer}
            onChange={e => setAnswer(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') handleAnswerSubmit(); }}
            placeholder="Type your answer..."
            autoFocus
            style={{
              width: '100%', background: 'rgba(var(--ov-color),0.06)',
              border: '1px solid rgba(var(--ov-color),0.12)',
              borderRadius: 8, padding: '8px 12px',
              fontSize: 13, color: '#ECE8E3',
              outline: 'none', fontFamily: 'inherit',
              boxSizing: 'border-box',
            }}
          />
          <button
            onClick={handleAnswerSubmit}
            style={{
              marginTop: 8, width: '100%', height: 34,
              background: '#4A9EFF', color: 'var(--on-accent)',
              border: 'none', borderRadius: 8,
              fontSize: 13, fontWeight: 600, cursor: 'pointer',
              display: 'flex', alignItems: 'center',
              justifyContent: 'center', gap: 6,
            }}
          >
            Send →
          </button>
        </div>
      )}

      {/* Main status panel */}
      <div style={{
        background: 'rgba(17,17,16,0.94)',
        border: '1px solid rgba(var(--ov-color),0.10)',
        borderRadius: 14, overflow: 'hidden',
        backdropFilter: 'blur(24px)',
      }}>
        {/* Header */}
        <div style={{
          display: 'flex', alignItems: 'center',
          padding: '12px 14px', gap: 10,
          borderBottom: collapsed ? 'none' : '1px solid rgba(var(--ov-color),0.07)',
        }}>
          <ClickMark size={20} radius={6} glow />
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: '#ECE8E3' }}>
              Click is running
            </div>
            <div style={{ fontSize: 11, color: '#8A8783', marginTop: 1 }}>
              {state.task.slice(0, 42)}{state.task.length > 42 ? '…' : ''}
            </div>
          </div>
          <span style={{
            width: 7, height: 7, borderRadius: '50%',
            background: '#4A9EFF',
            animation: 'dotpulse 1.6s ease-in-out infinite',
            flex: 'none',
          }} />
          <button
            onClick={() => setCollapsed(v => !v)}
            style={{
              background: 'none', border: 'none',
              cursor: 'pointer', color: '#5A5755',
              display: 'grid', placeItems: 'center',
              padding: 4, borderRadius: 5,
            }}
          >
            <Icon
              name="chevronDown" size={14} stroke={2}
              style={{
                transform: collapsed ? 'rotate(180deg)' : 'none',
                transition: 'transform .15s',
              }}
            />
          </button>
        </div>

        {!collapsed && (
          <div style={{ padding: '10px 14px 12px' }}>
            <div style={{
              fontSize: 10, fontWeight: 700,
              letterSpacing: '0.08em',
              textTransform: 'uppercase',
              color: '#5A5755', marginBottom: 8,
            }}>
              Current task
            </div>

            {currentThinking && (
              <div style={{
                display: 'flex', alignItems: 'flex-start', gap: 7,
                marginBottom: 9,
              }}>
                <Icon name="sparkle" size={11} stroke={1.8} style={{ color: '#4A9EFF', flex: 'none', marginTop: 2 }} />
                <span style={{
                  fontSize: 11.5, lineHeight: 1.45, color: '#A8A5A1',
                  display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical',
                  overflow: 'hidden',
                }}>
                  {currentThinking}
                </span>
              </div>
            )}

            <div style={{
              display: 'flex', flexDirection: 'column', gap: 5,
              maxHeight: 240, overflowY: 'auto',
            }}>
              {state.steps
                .filter(s => s.type === 'tool_call' || s.type === 'complete')
                .map((step) => {
                  const isDone = state.steps.some(
                    s => s.type === 'tool_result' && s.id === `${step.id}-result`
                  );
                  const isCurrent = !isDone && step === currentStep;
                  return (
                    <div key={step.id} style={{
                      display: 'flex', alignItems: 'center',
                      gap: 9, minHeight: 24,
                    }}>
                      <span style={{ flex: 'none', width: 16 }}>
                        {isDone
                          ? <Icon name="check" size={13} stroke={2.5} style={{ color: '#3ECF8E' }} />
                          : isCurrent
                            ? <Icon name="arrowRight" size={13} stroke={2} className="nudge" style={{ color: '#4A9EFF' }} />
                            : <span style={{
                                width: 6, height: 6, borderRadius: '50%',
                                background: '#5A5755', display: 'inline-block',
                              }} />
                        }
                      </span>
                      <span style={{
                        fontSize: 12.5,
                        color: isCurrent ? '#ECE8E3' : '#8A8783',
                        fontWeight: isCurrent ? 500 : 400,
                      }}>
                        {step.tool ? step.tool.replace(/_/g, ' ') : 'Complete'}
                      </span>
                    </div>
                  );
                })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
