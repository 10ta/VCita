import { Component, type ReactNode } from 'react';

/** 任何渲染期错误只影响出错的区域，并显示原因，而不是整页白屏 */
export class ErrorBoundary extends Component<{ children: ReactNode; area: string }, { error: Error | null }> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="form-error" role="alert" style={{ margin: '1rem' }}>
        <strong>{this.props.area}出错了：</strong>
        {this.state.error.message}
        <div className="row" style={{ marginTop: '0.75rem' }}>
          <button type="button" className="btn" onClick={() => this.setState({ error: null })}>重试</button>
          <button type="button" className="btn" onClick={() => location.reload()}>重新加载页面</button>
        </div>
      </div>
    );
  }
}
