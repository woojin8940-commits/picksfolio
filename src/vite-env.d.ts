/// <reference types="vite/client" />

// PortOne V2 Browser SDK — loaded from CDN in index.html.
// Only the narrow slice used by the payment flow is typed.
declare global {
  interface Window {
    PortOne?: {
      requestPayment: (params: {
        storeId: string;
        channelKey: string;
        paymentId: string;
        orderName: string;
        totalAmount: number;
        currency: 'KRW' | 'USD' | 'JPY' | string;
        payMethod:
          | 'CARD'
          | 'VIRTUAL_ACCOUNT'
          | 'TRANSFER'
          | 'MOBILE'
          | 'GIFT_CERTIFICATE'
          | 'EASY_PAY'
          | string;
        easyPay?: {
          easyPayProvider?:
            | 'TOSSPAY'
            | 'KAKAOPAY'
            | 'NAVERPAY'
            | 'SAMSUNGPAY'
            | 'PAYCO'
            | 'LPAY'
            | 'SSGPAY'
            | 'APPLEPAY'
            | string;
        };
        // 카드 결제 옵션. 나이스정보통신(신모듈)은 카드 결제 시 고정 할부 개월수를
        // 요구하므로 일시불(fixedMonth: 0)을 넣어 결제창이 오류 없이 뜨도록 한다.
        card?: {
          installment?: {
            monthOption?: {
              fixedMonth?: number;
              availableMonthList?: number[];
            };
          };
        };
        customer?: {
          customerId?: string;
          fullName?: string;
          phoneNumber?: string;
          email?: string;
        };
        customData?: string;
        redirectUrl?: string;
        noticeUrls?: string[];
      }) => Promise<{
        paymentId?: string;
        transactionType?: string;
        txId?: string;
        code?: string;
        message?: string;
      } | undefined>;

      requestIssueBillingKey: (params: {
        storeId: string;
        channelKey: string;
        billingKeyMethod: 'CARD' | 'MOBILE' | 'EASY_PAY' | 'PAYPAL' | string;
        issueId?: string;
        issueName?: string;
        displayAmount?: number;
        currency?: 'KRW' | 'USD' | 'JPY' | string;
        easyPay?: {
          easyPayProvider?:
            | 'TOSSPAY'
            | 'KAKAOPAY'
            | 'NAVERPAY'
            | 'SAMSUNGPAY'
            | 'PAYCO'
            | 'LPAY'
            | 'SSGPAY'
            | 'APPLEPAY'
            | string;
        };
        customer?: {
          customerId?: string;
          fullName?: string;
          phoneNumber?: string;
          email?: string;
        };
        customData?: string;
        redirectUrl?: string;
        noticeUrls?: string[];
      }) => Promise<{
        billingKey?: string;
        transactionType?: string;
        code?: string;
        message?: string;
        pgCode?: string;
        pgMessage?: string;
      } | undefined>;
    };
  }
}

export {};
