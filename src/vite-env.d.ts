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
