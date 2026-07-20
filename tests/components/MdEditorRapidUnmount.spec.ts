import { mount, flushPromises } from '@vue/test-utils'
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'

// The global setup mock keeps ordinary component tests fast. This file is the
// real-package lifecycle regression and must deliberately bypass that mock.
vi.unmock('md-editor-v3')

const { MdEditor, MdPreview, config } = await vi.importActual<typeof import('md-editor-v3')>('md-editor-v3')

const fakeMermaid = {
  initialize: vi.fn(),
  render: vi.fn(() => '<svg><g /></svg>'),
}

const fakeEchartsChart = {
  setOption: vi.fn(),
  resize: vi.fn(),
  dispose: vi.fn(),
}

const fakeEcharts = {
  init: vi.fn(() => fakeEchartsChart),
}

config({
  editorExtensions: {
    highlight: { instance: {} },
    prettier: { prettierInstance: { format: () => '' }, parserMarkdownInstance: {} },
    cropper: { instance: {} },
    screenfull: { instance: {} },
    mermaid: { instance: fakeMermaid },
    katex: { instance: {} },
    echarts: {
      instance: fakeEcharts,
      parseOption: () => ({}),
    },
  },
})

class LocalResizeObserver {
  constructor(callback: ResizeObserverCallback) {
    void callback
  }

  observe(target: Element): void {
    void target
  }

  unobserve(target: Element): void {
    void target
  }

  disconnect(): void { void 0 }
}

const originalResizeObserver = globalThis.ResizeObserver

// Image zoom has an unrelated debounce that can outlive happy-dom teardown.
describe('md-editor-v3 rapid unmount lifecycle', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    globalThis.ResizeObserver = LocalResizeObserver
  })

  afterEach(() => {
    globalThis.ResizeObserver = originalResizeObserver
  })

  it('does not query a cleared root during Mermaid replacement', async () => {
    const wrapper = mount(MdPreview, {
      props: {
        modelValue: '```mermaid\nflowchart TD\n  A --> B\n```',
        noKatex: true,
        noHighlight: true,
        noImgZoomIn: true,
        noEcharts: true,
      },
    })

    wrapper.unmount()
    await nextTick()
    await flushPromises()
    expect(fakeMermaid.render).not.toHaveBeenCalled()
  })

  it('does not query a cleared root during ECharts replacement', async () => {
    const wrapper = mount(MdPreview, {
      props: {
        modelValue: '```echarts\n{ series: [] }\n```',
        noKatex: true,
        noHighlight: true,
        noImgZoomIn: true,
        noMermaid: true,
      },
    })

    wrapper.unmount()
    await nextTick()
    await flushPromises()
    expect(fakeEcharts.init).not.toHaveBeenCalled()
  })

  it('does not observe a cleared CustomScrollbar wrapper after nextTick', async () => {
    const originalObserve = MutationObserver.prototype.observe
    const observedTargets: Array<Node | null> = []

    MutationObserver.prototype.observe = function (target: Node, options: MutationObserverInit): void {
      observedTargets.push(target)
      originalObserve.call(this, target, options)
    }

    try {
      const wrapper = mount(MdEditor, {
        props: {
          modelValue: 'text',
          noHighlight: true,
          noImgZoomIn: true,
          noKatex: true,
          noMermaid: true,
          noEcharts: true,
        },
      })

      wrapper.unmount()
      await nextTick()
      await flushPromises()

      expect(observedTargets).not.toContain(null)
    } finally {
      MutationObserver.prototype.observe = originalObserve
    }
  })
})
