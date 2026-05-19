
export const sendSmsCode = async (phoneNumber: string) => {
  try {
    console.log(`[SMS Service] Initiating SMS for ${phoneNumber}...`);
    
    // 1. Generate a 6-digit code on the client for this direct-send implementation
    const code = Math.floor(100000 + Math.random() * 900000).toString();
    
    // 2. Register the code with our server first so it can be verified later
    const registerRes = await fetch('/api/auth/register-code', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phoneNumber, code }),
    });

    if (!registerRes.ok) {
      const errData = await registerRes.json();
      throw new Error(errData.error || 'Failed to register code on server');
    }

    // 3. Send SMS via Aligo using CORS proxy
    // IMPORTANT: The full URL must be used to avoid local 404 errors
    const aligoApiUrl = 'https://apis.aligo.in/send/';
    const corsProxyPrefix = 'https://cors-anywhere.herokuapp.com/';
    const targetUrl = corsProxyPrefix + aligoApiUrl;
    
    const params = new URLSearchParams();
    params.append("key", "98nskefu979srh73p0441q6lx6wy11lp");
    params.append("userid", "zczc3030");
    params.append("sender", "01035638940");
    params.append("receiver", phoneNumber.replace(/[^0-9]/g, ""));
    params.append("msg", `[Picks] 인증번호 [${code}]를 입력해주세요.`);

    console.log(`[SMS Service] Sending to Aligo via proxy: ${targetUrl}`);
    
    const response = await fetch(targetUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'X-Requested-With': 'XMLHttpRequest' // Often required by CORS proxies
      },
      body: params.toString(),
    });

    const responseText = await response.text();
    console.log("[SMS Service] Aligo Proxy Response:", responseText);

    let result;
    try {
      result = JSON.parse(responseText);
    } catch (e) {
      // If proxy returns something else
      if (responseText.includes("Missing required request header")) {
        return {
          success: false,
          error: 'Proxy Error',
          message: 'CORS Proxy access required. Please visit https://cors-anywhere.herokuapp.com/corsdemo to enable temporary access.'
        };
      }
      throw new Error('Invalid response from Aligo proxy');
    }

    if (result.result_code === "1") {
      return { success: true, message: "인증번호가 발송되었습니다." };
    } else {
      return { 
        success: false, 
        error: 'Aligo Error', 
        message: result.message || '인증번호 발송에 실패했습니다.',
        aligo_res: result
      };
    }
  } catch (error: any) {
    console.error('SMS Service Error:', error);
    return { success: false, error: 'Send Error', message: error.message };
  }
};

export const verifySmsCode = async (phoneNumber: string, code: string) => {
  try {
    const response = await fetch('/api/auth/verify-sms', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phoneNumber, code }),
    });

    const responseText = await response.text();
    let result;
    try {
      result = JSON.parse(responseText);
    } catch (e) {
      return { success: false, error: 'Invalid JSON Response', message: '서버 응답 오류' };
    }

    if (!response.ok) {
      return { success: false, ...result };
    }

    return result;
  } catch (error: any) {
    console.error('SMS Verify Error:', error);
    return { success: false, error: 'Network Error', message: error.message };
  }
};
