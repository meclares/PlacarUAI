(function () {
  'use strict';

  var config = window.PLACARUAI_SUPABASE_CONFIG || {};
  var form = document.getElementById('auth-form');
  var title = document.getElementById('auth-title');
  var note = document.getElementById('auth-note');
  var displayNameField = document.getElementById('display-name-field');
  var displayNameInput = document.getElementById('display-name');
  var signupProfileFields = document.getElementById('signup-profile-fields');
  var signupPhoneInput = document.getElementById('signup-phone');
  var signupCityInput = document.getElementById('signup-city');
  var signupStateInput = document.getElementById('signup-state');
  var signupSportInput = document.getElementById('signup-sport');
  var emailInput = document.getElementById('email');
  var passwordInput = document.getElementById('password');
  var submitButton = document.getElementById('submit-auth');
  var googleButton = document.getElementById('google-auth');
  var toggleModeButton = document.getElementById('toggle-mode');
  var forgotButton = document.getElementById('forgot-password');
  var resendConfirmationButton = document.getElementById('resend-confirmation');
  var togglePasswordButton = document.getElementById('toggle-password');
  var rememberSessionInput = document.getElementById('remember-session');
  var message = document.getElementById('auth-message');
  var accountState = document.getElementById('account-state');
  var client = null;
  var mode = 'signin';
  var recoveryFormShown = false;
  var authStorage = window.placaruaiAuthStorage;
  rememberSessionInput.checked = authStorage ? authStorage.isRemembered() : true;
  signupStateInput.innerHTML = '<option value="">Selecione</option>' +
    window.PLACARUAI_BRAZIL_STATES.map(function (state) {
      return '<option value="' + state[0] + '">' + state[1] + '</option>';
    }).join('');

  rememberSessionInput.addEventListener('change', function () {
    if (!authStorage) {
      showMessage('A opção de permanência da sessão está indisponível. Recarregue a página.', true);
      return;
    }
    try {
      authStorage.setRemembered(rememberSessionInput.checked);
    } catch (error) {
      console.error('Unable to update session persistence', error);
      rememberSessionInput.checked = authStorage.isRemembered();
      showMessage('Não foi possível alterar a permanência da sessão neste dispositivo.', true);
    }
  });

  function showMessage(text, isError) {
    message.textContent = text;
    message.classList.toggle('error', Boolean(isError));
  }

  function setBusy(busy) {
    submitButton.disabled = busy;
    googleButton.disabled = busy;
    toggleModeButton.disabled = busy;
    forgotButton.disabled = busy;
    resendConfirmationButton.disabled = busy;
  }

  function isConfigured() {
    return typeof config.url === 'string' &&
      /^https:\/\/[a-z0-9-]+\.supabase\.co$/i.test(config.url) &&
      typeof config.publishableKey === 'string' &&
      config.publishableKey.startsWith('sb_publishable_');
  }

  function authRedirectUrl(path) {
    if (window.location.protocol !== 'http:' && window.location.protocol !== 'https:') {
      return null;
    }
    return new URL(path, window.location.href).href;
  }

  function redirectToApp() {
    window.location.assign(new URL('./PlacarUai.html', window.location.href).href);
  }

  function renderMode() {
    var signingUp = mode === 'signup';
    title.textContent = signingUp ? 'Crie sua conta grátis' : 'Entre na sua conta';
    note.textContent = signingUp
      ? 'Cadastro grátis. Complete seus dados para preencher o perfil; seu telefone permanece privado.'
      : 'Acesse seu perfil ou crie uma conta grátis.';
    submitButton.textContent = signingUp ? 'Criar conta gratuita' : 'Entrar';
    googleButton.hidden = signingUp;
    toggleModeButton.textContent = signingUp ? 'Já tenho uma conta' : 'Criar conta gratuita';
    displayNameField.hidden = !signingUp;
    displayNameInput.required = signingUp;
    displayNameInput.autocomplete = signingUp ? 'name' : 'off';
    signupProfileFields.hidden = !signingUp;
    signupPhoneInput.required = signingUp;
    signupCityInput.required = signingUp;
    signupStateInput.required = signingUp;
    signupSportInput.required = signingUp;
    forgotButton.hidden = signingUp;
    passwordInput.autocomplete = signingUp ? 'new-password' : 'current-password';
    passwordInput.minLength = 8;
    resendConfirmationButton.hidden = true;
    showMessage('', false);
  }

  function showPendingConfirmation(text) {
    resendConfirmationButton.hidden = false;
    showMessage(text, false);
  }

  async function resendConfirmation() {
    if (!client) {
      showMessage('O reenvio do link está indisponível no momento.', true);
      return;
    }
    if (!emailInput.value || !emailInput.checkValidity()) {
      emailInput.focus();
      showMessage('Informe um e-mail válido para reenviar o link.', true);
      return;
    }
    resendConfirmationButton.disabled = true;
    showMessage('Enviando solicitação...', false);
    try {
      var options = {};
      var redirectUrl = authRedirectUrl('./PlacarUai.html');
      if (redirectUrl) options.emailRedirectTo = redirectUrl;
      var result = await client.auth.resend({
        type: 'signup',
        email: emailInput.value.trim().toLowerCase(),
        options: options,
      });
      if (result.error) throw result.error;
      showPendingConfirmation('Se houver um cadastro pendente para esse e-mail, enviaremos um novo link.');
    } catch (error) {
      console.error('Confirmation email resend failed', error.code || String(error));
      showMessage('Não foi possível reenviar o link. Tente novamente mais tarde.', true);
    } finally {
      resendConfirmationButton.disabled = false;
    }
  }

  function renderSignedIn(user) {
    form.hidden = true;
    accountState.hidden = false;
    accountState.innerHTML = '';
    var heading = document.createElement('h2');
    heading.textContent = 'Você já está conectado';
    var identity = document.createElement('p');
    identity.className = 'form-note';
    identity.textContent = user.email || 'Sua conta PlacarUAI está ativa neste dispositivo.';
    var continueLink = document.createElement('a');
    continueLink.className = 'action primary';
    continueLink.href = './PlacarUai.html';
    continueLink.textContent = 'Continuar para o PlacarUAI';
    var signOutButton = document.createElement('button');
    signOutButton.className = 'action';
    signOutButton.type = 'button';
    signOutButton.textContent = 'Sair da conta';
    signOutButton.addEventListener('click', async function () {
      signOutButton.disabled = true;
      var result = await client.auth.signOut();
      if (result.error) {
        console.error('Unable to sign out from homepage', result.error.code);
        showMessage('Não foi possível sair da conta. Tente novamente.', true);
        signOutButton.disabled = false;
      } else {
        accountState.hidden = true;
        form.hidden = false;
        showMessage('Você saiu da sua conta.', false);
      }
    });
    accountState.append(heading, identity, continueLink, signOutButton);
    showMessage('', false);
  }

  function renderPasswordRecovery() {
    if (recoveryFormShown) return;
    recoveryFormShown = true;
    form.dataset.recovery = 'true';
    title.textContent = 'Redefina sua senha';
    note.textContent = 'Escolha uma nova senha para acessar sua conta.';
    form.innerHTML =
      '<label class="field" for="new-password">' +
      '<span class="field-label">Nova senha</span>' +
      '<input id="new-password" type="password" autocomplete="new-password" minlength="8" required>' +
      '</label>' +
      '<label class="field" for="confirm-password">' +
      '<span class="field-label">Confirme a nova senha</span>' +
      '<input id="confirm-password" type="password" autocomplete="new-password" minlength="8" required>' +
      '</label>' +
      '<div class="form-actions"><button class="action primary" type="submit">Salvar nova senha</button></div>' +
      '<p id="recovery-message" class="message" role="status" aria-live="polite"></p>';
    form.addEventListener('submit', async function (event) {
      event.preventDefault();
      var recoveryMessage = document.getElementById('recovery-message');
      var newPassword = document.getElementById('new-password').value;
      var confirmation = document.getElementById('confirm-password').value;
      var saveButton = form.querySelector('button[type="submit"]');
      if (newPassword.length < 8) {
        recoveryMessage.textContent = 'A nova senha precisa ter pelo menos 8 caracteres.';
        recoveryMessage.classList.add('error');
        return;
      }
      if (newPassword !== confirmation) {
        recoveryMessage.textContent = 'As senhas informadas não são iguais.';
        recoveryMessage.classList.add('error');
        return;
      }
      saveButton.disabled = true;
      recoveryMessage.textContent = 'Salvando sua nova senha...';
      recoveryMessage.classList.remove('error');
      var result;
      try {
        result = await client.auth.updateUser({ password: newPassword });
      } catch (error) {
        console.error('Unable to update recovered password', String(error));
        recoveryMessage.textContent = 'Não foi possível atualizar a senha. Solicite um novo link de recuperação.';
        recoveryMessage.classList.add('error');
        saveButton.disabled = false;
        return;
      }
      if (result.error) {
        console.error('Unable to update recovered password', result.error.code);
        recoveryMessage.textContent = 'Não foi possível atualizar a senha. Solicite um novo link de recuperação.';
        recoveryMessage.classList.add('error');
        saveButton.disabled = false;
        return;
      }
      window.history.replaceState(null, '', window.location.pathname);
      recoveryMessage.textContent = 'Senha atualizada. Abrindo sua conta...';
      window.setTimeout(redirectToApp, 700);
    });
  }

  document.getElementById('auth-form').addEventListener('submit', async function (event) {
    if (form.dataset.recovery === 'true') return;
    event.preventDefault();
    if (!client) {
      showMessage('A autenticação está indisponível. Tente novamente mais tarde.', true);
      return;
    }
    if (!form.reportValidity()) return;
    if (mode === 'signup' && !displayNameInput.value.trim()) {
      showMessage('Informe o nome que será exibido no seu perfil.', true);
      displayNameInput.focus();
      return;
    }

    setBusy(true);
    showMessage(mode === 'signup' ? 'Criando sua conta...' : 'Entrando...', false);
    try {
      if (!authStorage) throw new Error('Session persistence storage is unavailable');
      authStorage.setRemembered(rememberSessionInput.checked);
      var result;
      if (mode === 'signup') {
        var signupOptions = { data: {
          display_name: displayNameInput.value.trim(),
          phone: signupPhoneInput.value.trim(),
          city: signupCityInput.value.trim(),
          state: signupStateInput.value,
          favorite: signupSportInput.value,
        } };
        var signupRedirectUrl = authRedirectUrl('./PlacarUai.html');
        if (signupRedirectUrl) signupOptions.emailRedirectTo = signupRedirectUrl;
        result = await client.auth.signUp({
          email: emailInput.value.trim().toLowerCase(),
          password: passwordInput.value,
          options: signupOptions,
        });
      } else {
        result = await client.auth.signInWithPassword({
          email: emailInput.value.trim().toLowerCase(),
          password: passwordInput.value,
        });
      }
      if (result.error) {
        console.error('Homepage authentication failed', result.error.code);
        if (mode === 'signin' && result.error.code === 'email_not_confirmed') {
          showPendingConfirmation('Confirme seu e-mail antes de entrar em quadra. Você pode reenviar o link.');
        } else {
          showMessage(
            mode === 'signup'
              ? 'Não foi possível criar a conta. Verifique o e-mail e tente novamente.'
              : 'Não foi possível entrar. Confira seu e-mail e sua senha.',
            true,
          );
        }
      } else if (mode === 'signup' && !result.data.session) {
        showPendingConfirmation('Enviamos um link de confirmação para o seu e-mail. Confirme para entrar em quadra!');
      } else {
        redirectToApp();
      }
    } catch (error) {
      console.error('Homepage authentication request failed', String(error));
      showMessage('O serviço de autenticação não respondeu. Tente novamente.', true);
    } finally {
      setBusy(false);
    }
  });

  toggleModeButton.addEventListener('click', function () {
    mode = mode === 'signin' ? 'signup' : 'signin';
    renderMode();
  });

  resendConfirmationButton.addEventListener('click', resendConfirmation);

  togglePasswordButton.addEventListener('click', function () {
    var visible = passwordInput.type === 'password';
    passwordInput.type = visible ? 'text' : 'password';
    togglePasswordButton.textContent = visible ? 'Ocultar' : 'Mostrar';
    togglePasswordButton.setAttribute('aria-label', visible ? 'Ocultar senha' : 'Mostrar senha');
    togglePasswordButton.setAttribute('aria-pressed', String(visible));
  });

  forgotButton.addEventListener('click', async function () {
    if (!client) {
      showMessage('A recuperação de senha está indisponível no momento.', true);
      return;
    }
    if (!emailInput.value || !emailInput.checkValidity()) {
      emailInput.focus();
      showMessage('Informe um e-mail válido para receber o link de recuperação.', true);
      return;
    }
    forgotButton.disabled = true;
    showMessage('Enviando solicitação de recuperação...', false);
    try {
      var recoveryOptions = {};
      var recoveryRedirectUrl = authRedirectUrl('./index.html?recovery=1');
      if (recoveryRedirectUrl) recoveryOptions.redirectTo = recoveryRedirectUrl;
      var result = await client.auth.resetPasswordForEmail(
        emailInput.value.trim().toLowerCase(),
        recoveryOptions,
      );
      if (result.error) {
        console.error('Password recovery request failed', result.error.code);
        showMessage('Não foi possível enviar o link. Tente novamente mais tarde.', true);
      } else {
        showMessage('Se esse e-mail estiver cadastrado, você receberá um link para redefinir a senha.', false);
      }
    } catch (error) {
      console.error('Password recovery request failed', String(error));
      showMessage('Não foi possível enviar o link de recuperação. Tente novamente.', true);
    } finally {
      forgotButton.disabled = false;
    }
  });

  googleButton.addEventListener('click', async function () {
    if (!client) {
      showMessage('O login com Google está indisponível no momento.', true);
      return;
    }
    googleButton.disabled = true;
    showMessage('Conectando com o Google...', false);
    try {
      if (!authStorage) throw new Error('Session persistence storage is unavailable');
      authStorage.setRemembered(rememberSessionInput.checked);
      var oauthOptions = {};
      var oauthRedirectUrl = authRedirectUrl('./PlacarUai.html');
      if (oauthRedirectUrl) oauthOptions.redirectTo = oauthRedirectUrl;
      var result = await client.auth.signInWithOAuth({
        provider: 'google',
        options: oauthOptions,
      });
      if (result.error) {
        console.error('Google sign-in failed', result.error.code);
        showMessage('Não foi possível iniciar o login com Google. Verifique se o provedor está configurado.', true);
        googleButton.disabled = false;
      }
    } catch (error) {
      console.error('Google sign-in request failed', String(error));
      showMessage('Não foi possível iniciar o login com Google. Tente novamente.', true);
      googleButton.disabled = false;
    }
  });

  if (!window.supabase || typeof window.supabase.createClient !== 'function') {
    showMessage('O serviço de autenticação não carregou. Você ainda pode acessar o placar público.', true);
  } else if (!isConfigured()) {
    showMessage('Configure o projeto Supabase para entrar ou criar uma conta. O placar público continua disponível.', true);
  } else {
    client = window.supabase.createClient(config.url, config.publishableKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
        storage: authStorage && authStorage.storage,
      },
    });
    client.auth.onAuthStateChange(function (event, session) {
      if (event === 'PASSWORD_RECOVERY') {
        renderPasswordRecovery();
      } else if (event === 'SIGNED_OUT' && accountState.hidden === false) {
        accountState.hidden = true;
        form.hidden = false;
      } else if (event === 'SIGNED_IN' && session && accountState.hidden) {
        renderSignedIn(session.user);
      }
    });
    client.auth.getSession().then(function (result) {
      if (result.error) throw result.error;
      if (new URLSearchParams(window.location.search).has('recovery')) {
        renderPasswordRecovery();
      } else if (result.data.session) {
        renderSignedIn(result.data.session.user);
      }
    }).catch(function (error) {
      console.error('Unable to restore homepage authentication session', error);
      showMessage('Não foi possível verificar a sessão. Você ainda pode consultar o placar público.', true);
    });
  }
})();
