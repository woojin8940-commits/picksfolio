import { useEffect, useRef } from 'react';
import type { Language } from '../contexts/LanguageContext';

const KOREAN_PATTERN = /[가-힣]/;
const TRANSLATABLE_ATTRIBUTES = ['placeholder', 'title', 'aria-label', 'alt', 'value', 'content'] as const;
const PRESERVE_SELECTOR = '[data-user-content], [translate="no"], textarea, [contenteditable="true"]';

/**
 * 폼 컨트롤의 `value` 는 화면 문구가 아니라 사용자가 직접 입력한 내용이다.
 *
 * 이걸 번역해 버리면 화면에 보이는 값과 실제로 저장·발송되는 값이 갈라진다.
 * 예를 들어 DM 자동화의 메시지 입력란은 여기 적힌 문장이 그대로 인스타그램으로
 * 나가는데, 표시만 영어로 바꿔 놓으면 사용자는 영어를 읽으면서 한국어 DM 을
 * 보내게 된다. `placeholder` 처럼 우리가 넣은 안내 문구는 계속 번역한다.
 */
const USER_EDITED_VALUE_TAGS = new Set(['INPUT', 'TEXTAREA', 'SELECT']);
const isUserEditedValue = (element: Element, attribute: string) =>
  attribute === 'value' && USER_EDITED_VALUE_TAGS.has(element.tagName);

interface PlatformLanguageBridgeProps {
  language: Language;
  translatePlatformText: (value: string) => string;
}

const shouldPreserveText = (node: Text) => node.parentElement?.closest(PRESERVE_SELECTOR) !== null;

export default function PlatformLanguageBridge({ language, translatePlatformText }: PlatformLanguageBridgeProps) {
  const originalTexts = useRef(new Map<Text, string>());
  const originalAttributes = useRef(new Map<Element, Map<string, string>>());
  const originalTitle = useRef<string | null>(null);

  useEffect(() => {
    document.documentElement.lang = language;

    const restoreKorean = () => {
      originalTexts.current.forEach((value, node) => {
        if (node.isConnected) node.data = value;
      });
      originalAttributes.current.forEach((attributes, element) => {
        if (!element.isConnected) return;
        attributes.forEach((value, attribute) => element.setAttribute(attribute, value));
      });
      if (originalTitle.current !== null) document.title = originalTitle.current;
      originalTexts.current.clear();
      originalAttributes.current.clear();
      originalTitle.current = null;
    };

    if (language === 'ko') {
      restoreKorean();
      return;
    }

    const translateTextNode = (node: Text) => {
      if (!KOREAN_PATTERN.test(node.data) || shouldPreserveText(node)) return;
      const translated = translatePlatformText(node.data);
      if (translated === node.data) return;
      originalTexts.current.set(node, node.data);
      node.data = translated;
    };

    const translateElementAttributes = (element: Element) => {
      if (element.closest('[data-user-content], [translate="no"]')) return;
      TRANSLATABLE_ATTRIBUTES.forEach(attribute => {
        if (isUserEditedValue(element, attribute)) return;
        const value = element.getAttribute(attribute);
        if (!value || !KOREAN_PATTERN.test(value)) return;
        const translated = translatePlatformText(value);
        if (translated === value) return;
        const originals = originalAttributes.current.get(element) ?? new Map<string, string>();
        originals.set(attribute, value);
        originalAttributes.current.set(element, originals);
        element.setAttribute(attribute, translated);
      });
    };

    const translateTree = (root: Node) => {
      if (root.nodeType === Node.TEXT_NODE) {
        translateTextNode(root as Text);
        return;
      }
      if (root.nodeType !== Node.ELEMENT_NODE && root.nodeType !== Node.DOCUMENT_FRAGMENT_NODE) return;
      if (root.nodeType === Node.ELEMENT_NODE) translateElementAttributes(root as Element);

      const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT);
      let current = walker.nextNode();
      while (current) {
        if (current.nodeType === Node.TEXT_NODE) translateTextNode(current as Text);
        else translateElementAttributes(current as Element);
        current = walker.nextNode();
      }
    };

    if (KOREAN_PATTERN.test(document.title)) {
      const translatedTitle = translatePlatformText(document.title);
      if (translatedTitle !== document.title) {
        originalTitle.current = document.title;
        document.title = translatedTitle;
      }
    }

    translateTree(document.body);

    const observer = new MutationObserver(mutations => {
      mutations.forEach(mutation => {
        if (mutation.type === 'characterData') {
          translateTextNode(mutation.target as Text);
          return;
        }
        if (mutation.type === 'attributes') {
          translateElementAttributes(mutation.target as Element);
          return;
        }
        mutation.addedNodes.forEach(translateTree);
      });
    });
    observer.observe(document.body, {
      subtree: true,
      childList: true,
      characterData: true,
      attributes: true,
      attributeFilter: [...TRANSLATABLE_ATTRIBUTES],
    });

    const nativeAlert = window.alert.bind(window);
    const nativeConfirm = window.confirm.bind(window);
    const nativePrompt = window.prompt.bind(window);
    window.alert = message => nativeAlert(typeof message === 'string' ? translatePlatformText(message) : message);
    window.confirm = message => nativeConfirm(message === undefined ? message : translatePlatformText(message));
    window.prompt = (message, defaultValue) => nativePrompt(message === undefined ? message : translatePlatformText(message), defaultValue);

    return () => {
      observer.disconnect();
      window.alert = nativeAlert;
      window.confirm = nativeConfirm;
      window.prompt = nativePrompt;
    };
  }, [language, translatePlatformText]);

  return null;
}
