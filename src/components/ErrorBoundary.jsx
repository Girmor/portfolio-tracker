import { Component } from 'react'
import { AlertTriangle } from 'lucide-react'

export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { hasError: false, error: null }
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error }
  }

  componentDidCatch(error, info) {
    console.error('[ErrorBoundary]', error, info)
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex items-center justify-center min-h-[300px]">
          <div className="glass-card rounded-xl p-8 max-w-md w-full text-center">
            <AlertTriangle size={32} className="text-red-400 mx-auto mb-4" />
            <h3 className="text-lg font-semibold text-white mb-2">Щось пішло не так</h3>
            <p className="text-sm text-slate-400 mb-6 font-mono break-all">
              {this.state.error?.message || 'Невідома помилка'}
            </p>
            <button
              onClick={() => this.setState({ hasError: false, error: null })}
              className="bg-blue-600 hover:bg-blue-500 text-white px-5 py-2 rounded-lg text-sm font-medium transition-colors active:scale-95"
            >
              Спробувати знову
            </button>
          </div>
        </div>
      )
    }
    return this.props.children
  }
}
