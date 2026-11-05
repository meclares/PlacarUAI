(function () {
  'use strict';

  var config = window.PLACARUAI_SUPABASE_CONFIG || {};
  var legacyRenderProfile = window.renderProfile;
  var client = null;
  var currentUser = null;
  var currentProfile = null;
  var canManage = false;
  var remoteTournaments = [];
  var saveQueue = Promise.resolve();
  var TKEY = 'placaruai.tournaments.v1';
  var PKEY = 'placaruai.profile.v1';
  var AKEY = 'placaruai.account.v1';
  var LKEY = 'placaruai.athlete.matches.v1';

  window.placaruaiCanManage = false;

  function report(message) {
    var status = document.getElementById('st');
    if (status) {
      status.textContent = message;
      status.classList.remove('hide');
      window.setTimeout(function () {
        status.classList.add('hide');
      }, 7000);
    } else {
      window.alert(message);
    }
  }

  function configured() {
    return typeof config.url === 'string' &&
      /^https:\/\/[a-z0-9-]+\.supabase\.co$/i.test(config.url) &&
      typeof config.publishableKey === 'string' &&
      config.publishableKey.startsWith('sb_publishable_');
  }

  function signupProfileFromMetadata(metadata) {
    metadata = metadata && typeof metadata === 'object' ? metadata : {};
    var profile = {};
    var name = String(metadata.display_name || metadata.full_name || metadata.name || '').trim();
    var phone = String(metadata.phone || '').trim();
    var city = String(metadata.city || '').trim();
    var state = String(metadata.state || '').trim().toUpperCase();
    var favorite = String(metadata.favorite || '').trim();
    if (name) profile.name = name;
    if (/^[0-9+() .-]{8,20}$/.test(phone)) profile.phone = phone;
    if (city) profile.city = city.slice(0, 60);
    if (window.PLACARUAI_BRAZIL_STATES.some(function (item) { return item[0] === state; })) {
      profile.state = state;
    }
    if (['volei', 'futevolei', 'beach'].indexOf(favorite) >= 0) profile.favorite = favorite;
    return profile;
  }

  function authRedirectUrl(path) {
    if (window.location.protocol !== 'http:' && window.location.protocol !== 'https:') {
      return null;
    }
    return new URL(path, window.location.href).href;
  }

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function showGate(message) {
    var dialog = document.getElementById('tourDialog');
    var title = currentUser ? 'Seu histórico de campeonatos' : 'Placar Uai · Assinatura mensal';
    dialog.innerHTML =
      '<div class="tour-shell"><div class="tour-head"><div><h2>' + title +
      '</h2><p>R$ 49,90 por mês</p></div><button class="tour-close">Fechar</button></div>' +
      '<div class="tour-body"><div class="tour-panel tour-access"><div class="tour-title">' +
      (currentUser ? 'Acesso de gerenciamento inativo' : 'Entre ou crie sua conta') +
      '</div><p class="tour-muted">' + message + '</p>' +
      (!currentUser ? '<button id="tourAccount" class="go">Entrar ou criar conta</button>' : '') +
      (currentUser ? '<button id="subscribe" class="go">Assinar ou renovar · R$ 49,90/mês</button>' : '') +
      '</div><section id="tourHistory" class="tour-panel"><div class="tour-title">Histórico preservado</div>' +
      renderHistoryList(remoteTournaments) + '<div id="finalReport"></div></section></div></div>';
    dialog.querySelector('.tour-close').onclick = function () { dialog.close(); };
    var accountButton = dialog.querySelector('#tourAccount');
    if (accountButton) accountButton.onclick = window.openAccount;
    var subscribeButton = dialog.querySelector('#subscribe');
    if (subscribeButton) subscribeButton.onclick = startCheckout;
    wireHistoryButtons(dialog);
  }

  function showTournamentLibrary() {
    var dialog = document.getElementById('tourDialog');
    dialog.innerHTML =
      '<div class="tour-shell"><div class="tour-head"><div><h2>Meus campeonatos</h2>' +
      '<p>Seu histórico fica disponível sem assinatura.</p></div>' +
      '<button class="tour-close" aria-label="Fechar">Fechar</button></div>' +
      '<div class="tour-body"><div class="tour-panel"><div class="tour-title">Criar campeonato</div>' +
      '<p class="tour-muted">A assinatura é solicitada somente quando você iniciar a criação de um torneio.</p>' +
      '<button id="startTournament" class="go">Criar campeonato</button></div>' +
      '<section id="tourHistory" class="tour-panel"><div class="tour-title">Histórico preservado</div>' +
      renderHistoryList(remoteTournaments) + '<div id="finalReport"></div></section></div></div>';
    dialog.querySelector('.tour-close').onclick = function () { dialog.close(); };
    dialog.querySelector('#startTournament').onclick = function () {
      showGate('Para criar e gerenciar um campeonato, ative a assinatura mensal. Seu histórico continua preservado.');
    };
    wireHistoryButtons(dialog);
  }

  function renderHistoryList(list) {
    if (!list.length) return '<p class="tour-muted">Nenhum campeonato foi importado ou criado nesta conta.</p>';
    return '<div class="tour-list">' + list.map(function (tournament) {
      var status = tournament.stageLabel || tournament.stage || tournament.status || 'Histórico';
      return '<button class="tour-team" data-history-id="' + window.esc(tournament.id) + '">' +
        '<span><strong>' + window.esc(tournament.name || 'Campeonato') + '</strong>' +
        '<small>' + window.esc(tournament.sportName || 'Esporte não informado') +
        ' · ' + window.esc(status) + ' · ' + Number((tournament.teams || []).length) +
        ' duplas</small></span><span>Ver relatório</span></button>';
    }).join('') + '</div>';
  }

  function wireHistoryButtons(dialog) {
    dialog.querySelectorAll('[data-history-id]').forEach(function (button) {
      button.onclick = function () {
        var tournament = remoteTournaments.find(function (item) {
          return item.id === button.dataset.historyId;
        });
        if (!tournament) return;
        var placements = tournament.placements || {};
        var teams = tournament.teams || [];
        var places = Object.keys(placements).map(function (teamId) {
          var team = teams.find(function (entry) { return entry.id === teamId; });
          return { position: Number(placements[teamId]), team: team };
        }).filter(function (entry) {
          return entry.team && entry.position >= 1 && entry.position <= 3;
        }).sort(function (a, b) { return a.position - b.position; });
        var report = dialog.querySelector('#finalReport');
        report.innerHTML = '<div class="tour-panel"><div class="tour-title">Relatório · ' +
          window.esc(tournament.name || 'Campeonato') + '</div><p class="tour-muted">' +
          Number((tournament.teams || []).length) + ' duplas · ' +
          Number((tournament.groupMatches || []).length) + ' jogos de grupo · ' +
          Number((tournament.rounds || []).reduce(function (count, round) {
            return count + (Array.isArray(round) ? round.length : 0);
          }, 0)) + ' jogos de chave</p>' +
          (places.length ? '<ol>' + places.map(function (entry) {
            return '<li>' + entry.position + 'º — ' +
              window.esc((entry.team.name1 || '') + ' / ' + (entry.team.name2 || '')) +
              '</li>';
          }).join('') + '</ol>' : '<p class="tour-muted">Classificação final não registrada.</p>') +
          '</div>';
      };
    });
  }

  async function checkManagement() {
    var result = await client.rpc('can_manage_tournaments');
    if (result.error) throw result.error;
    canManage = result.data === true;
    window.placaruaiCanManage = canManage;
    return canManage;
  }

  async function loadOwnedTournaments() {
    var result = await client.from('tournaments')
      .select('id, name, status, is_published, participant_count, created_at, completed_at, payload')
      .eq('organizer_id', currentUser.id)
      .order('created_at', { ascending: false });
    if (result.error) throw result.error;
    remoteTournaments = (result.data || []).map(function (row) {
      var tournament = row.payload;
      if (!tournament || typeof tournament !== 'object' || Array.isArray(tournament)) {
        throw new Error('A saved tournament has an invalid data format.');
      }
      tournament.id = row.id;
      tournament.name = row.name;
      tournament.is_published = row.is_published;
      return tournament;
    });
    return remoteTournaments;
  }

  function rowForTournament(tournament) {
    var stage = tournament.stage;
    var status = stage === 'done'
      ? 'completed'
      : stage && stage !== 'registration'
      ? 'in_progress'
      : 'registration';
    var created = tournament.created && !Number.isNaN(Date.parse(tournament.created))
      ? new Date(tournament.created).toISOString()
      : new Date().toISOString();
    return {
      organizer_id: currentUser.id,
      id: String(tournament.id),
      name: String(tournament.name || 'Campeonato').slice(0, 60),
      status: status,
      is_published: tournament.is_published === true,
      participant_count: Array.isArray(tournament.teams) ? tournament.teams.length : 0,
      created_at: created,
      completed_at: status === 'completed'
        ? (tournament.completedAt || created)
        : null,
      payload: tournament,
    };
  }

  async function persistTournamentList(list) {
    if (!client || !currentUser || !canManage) {
      report('A assinatura ativa é validada pelo servidor antes de salvar alterações.');
      return;
    }
    var rows = list.map(rowForTournament);
    if (!rows.length) return;
    var result = await client.from('tournaments')
      .upsert(rows, { onConflict: 'organizer_id,id' });
    if (result.error) {
      console.error('Tournament write rejected by Supabase', result.error.code);
      report('Não foi possível salvar. Verifique a assinatura e tente novamente.');
      try {
        await loadOwnedTournaments();
      } catch (loadError) {
        console.error('Unable to reload tournaments after a rejected write', loadError);
        report('Falha ao atualizar o histórico do servidor.');
      }
      return;
    }
    remoteTournaments = clone(list);
  }

  async function startCheckout() {
    if (!client || !currentUser) {
      window.openAccount();
      return;
    }
    var result;
    try {
      result = await client.functions.invoke('create-subscription', { body: {} });
    } catch (error) {
      console.error('Subscription checkout request failed', error);
      report('Não foi possível iniciar a assinatura. Verifique a conexão e tente novamente.');
      return;
    }
    if (result.error) {
      console.error('Subscription checkout request failed', result.error);
      report('Não foi possível iniciar a assinatura. Tente novamente mais tarde.');
      return;
    }
    var checkoutUrl = result.data && result.data.checkoutUrl;
    try {
      var checkout = new URL(checkoutUrl);
      if (
        checkout.protocol !== 'https:' ||
        !/(^|\.)mercadopago\.com(\.br)?$/i.test(checkout.hostname)
      ) throw new Error('Untrusted checkout host');
      window.location.assign(checkout.toString());
    } catch (error) {
      console.error('Payment provider returned an invalid checkout URL', error);
      report('O provedor retornou um endereço de pagamento inválido.');
    }
  }

  async function loadSubscription() {
    if (!client || !currentUser) return null;
    var result = await client.from('subscriptions')
      .select('status, current_period_start, current_period_end, cancelled_at, provider_status')
      .eq('user_id', currentUser.id)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (result.error) throw result.error;
    return result.data;
  }

  function downloadJson(filename, data) {
    var blob = new Blob([JSON.stringify(data, null, 2)], {
      type: 'application/json',
    });
    var link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = filename;
    link.click();
    URL.revokeObjectURL(link.href);
  }

  async function exportLocalData() {
    if (!currentUser) return;
    var profile = window.ld(PKEY, null);
    if (
      profile && (
        !profile.ownerEmail ||
        profile.ownerEmail.toLowerCase() !== String(currentUser.email || '').toLowerCase()
      )
    ) profile = null;
    var matches = window.ld(LKEY, []);
    if (!Array.isArray(matches)) matches = [];
    matches = matches.filter(function (match) {
      return match && match.email &&
        String(match.email).toLowerCase() === String(currentUser.email || '').toLowerCase();
    });
    var result = await client.from('tournaments')
      .select('id, payload')
      .eq('organizer_id', currentUser.id);
    if (result.error) {
      console.error('Unable to export server tournaments', result.error.code);
      report('Não foi possível exportar os campeonatos da conta.');
      return;
    }
    downloadJson('placaruai-export.json', {
      format: 'placaruai-local-export-v1',
      createdAt: new Date().toISOString(),
      profile: profile,
      matchHistory: matches,
      tournaments: (result.data || []).map(function (row) { return row.payload; }),
      localTournaments: window.ld(TKEY, []),
    });
  }

  function validTournament(item) {
    return item && typeof item === 'object' && !Array.isArray(item) &&
      typeof item.id === 'string' && item.id.length > 0 && item.id.length <= 100 &&
      typeof item.name === 'string' && item.name.length <= 60 &&
      Array.isArray(item.teams) && item.teams.length <= 64;
  }

  async function importLocalData(file) {
    if (!file || file.size > 5 * 1024 * 1024) {
      report('Escolha um arquivo JSON de até 5 MB.');
      return;
    }
    var data;
    try {
      data = JSON.parse(await file.text());
    } catch (error) {
      console.error('Invalid local export file', error);
      report('O arquivo selecionado não contém JSON válido.');
      return;
    }
    if (!data || data.format !== 'placaruai-local-export-v1') {
      report('Este arquivo não é uma exportação compatível do PlacarUai.');
      return;
    }

    var tournaments = [].concat(
      Array.isArray(data.tournaments) ? data.tournaments : [],
      Array.isArray(data.localTournaments) ? data.localTournaments : [],
    );
    if (tournaments.some(function (item) { return !validTournament(item); })) {
      report('O arquivo contém campeonatos com dados inválidos.');
      return;
    }
    if (tournaments.length && !window.confirm(
      'Confirma que você é o organizador ou tem autorização para transferir ' +
      tournaments.length + ' campeonato(s) para esta conta?'
    )) return;
    if (tournaments.length) {
      try {
        await checkManagement();
      } catch (error) {
        console.error('Unable to verify import permissions', error);
        report('Não foi possível verificar a autorização para importar.');
        return;
      }
      if (!canManage) {
        report('Ative ou renove a assinatura para importar e gerenciar campeonatos.');
        return;
      }
    }

    var profile = data.profile && typeof data.profile === 'object' ? data.profile : null;
    var matches = Array.isArray(data.matchHistory) ? data.matchHistory : [];
    if (matches.length > 500) {
      report('A exportação contém mais de 500 partidas; divida o arquivo antes de importar.');
      return;
    }
    if (matches.some(function (match) {
      return !match || typeof match !== 'object' || Array.isArray(match);
    })) {
      report('O arquivo contém partidas com dados inválidos.');
      return;
    }
    if (profile) {
      profile.ownerEmail = currentUser.email || '';
      var profileResult = await client.from('profiles').update({
        display_name: String(profile.name || '').slice(0, 80),
        profile_data: profile,
      }).eq('user_id', currentUser.id);
      if (profileResult.error) {
        console.error('Unable to import profile', profileResult.error.code);
        report('Não foi possível importar o perfil.');
        return;
      }
      localStorage.setItem(PKEY, JSON.stringify(profile));
    }

    if (matches.length) {
      var matchRows = matches.map(function (match, index) {
        return {
          user_id: currentUser.id,
          id: String(match.id || 'import-' + index).slice(0, 100),
          played_at: match.at && !Number.isNaN(Date.parse(match.at))
            ? new Date(match.at).toISOString()
            : null,
          match_data: match,
        };
      });
      var matchResult = await client.from('match_history')
        .upsert(matchRows, { onConflict: 'user_id,id' });
      if (matchResult.error) {
        console.error('Unable to import private match history', matchResult.error.code);
        report('Não foi possível importar o histórico pessoal.');
        return;
      }
      matches.forEach(function (match) {
        match.email = currentUser.email || '';
      });
      localStorage.setItem(LKEY, JSON.stringify(matches));
    }

    if (tournaments.length) {
      var unique = new Map();
      tournaments.forEach(function (tournament) {
        unique.set(tournament.id, tournament);
      });
      var importRows = Array.from(unique.values()).map(rowForTournament);
      var tournamentResult = await client.from('tournaments')
        .upsert(importRows, { onConflict: 'organizer_id,id' });
      if (tournamentResult.error) {
        console.error('Unable to import tournaments', tournamentResult.error.code);
        report('A importação dos campeonatos foi recusada. Verifique sua assinatura.');
        return;
      }
    }

    await loadOwnedTournaments();
    report('Importação concluída. Senhas e credenciais locais não são transferidas.');
    window.renderProfile();
  }

  function addPublicBrowseControl() {
    var wrap = document.querySelector('#profile .profile-wrap');
    if (!wrap || wrap.querySelector('#publicTournamentBrowse')) return;
    var button = document.createElement('a');
    button.id = 'publicTournamentBrowse';
    button.className = 'go';
    button.href = './campeonatos.html';
    button.textContent = 'Consultar campeonatos públicos';
    button.style.display = 'inline-flex';
    button.style.alignItems = 'center';
    button.style.marginTop = '12px';
    wrap.appendChild(button);
  }

  function renderHeaderAccount() {
    var slot = document.getElementById('accountSlot');
    if (!slot) return;

    var button = document.createElement('button');
    button.id = 'accountButton';
    button.type = 'button';
    button.className = 'account-button';
    button.addEventListener('click', function () {
      if (currentUser && window.activateAuthenticatedTab) {
        window.activateAuthenticatedTab('profile');
      } else {
        showAccountDialog();
      }
    });

    if (!currentUser) {
      button.textContent = 'Entrar';
      button.setAttribute('aria-label', 'Entrar ou criar uma conta');
      button.title = 'Entrar ou criar uma conta';
      slot.replaceChildren(button);
      return;
    }

    var metadata = currentUser.user_metadata || {};
    var localProfile = window.ld(PKEY, null);
    if (localProfile && String(localProfile.ownerEmail || '').toLowerCase() !==
      String(currentUser.email || '').toLowerCase()) {
      localProfile = null;
    }
    var profileData = currentProfile && currentProfile.profile_data || {};
    var displayName = currentProfile && currentProfile.display_name ||
      profileData.name ||
      localProfile && localProfile.name ||
      metadata.full_name ||
      metadata.name ||
      (currentUser.email || '').split('@')[0] ||
      'Minha conta';
    displayName = String(displayName).trim().slice(0, 60) || 'Minha conta';

    var avatar = document.createElement('span');
    avatar.className = 'account-avatar';
    avatar.setAttribute('aria-hidden', 'true');
    avatar.textContent = displayName.slice(0, 1).toLocaleUpperCase('pt-BR');

    var avatarUrl = profileData.photo || localProfile && localProfile.photo ||
      metadata.avatar_url || metadata.picture;
    if (typeof avatarUrl === 'string' &&
      (/^https?:\/\//i.test(avatarUrl) || /^data:image\/(?:png|jpeg|gif|webp);base64,/i.test(avatarUrl))) {
      var image = document.createElement('img');
      image.src = avatarUrl;
      image.alt = '';
      image.onerror = function () { image.remove(); };
      avatar.replaceChildren(image);
    }

    var name = document.createElement('span');
    name.className = 'account-name';
    name.textContent = displayName;
    button.append(avatar, name);
    button.setAttribute('aria-label', 'Abrir perfil de ' + displayName);
    button.title = 'Abrir perfil';
    slot.replaceChildren(button);
  }

  function showAccountDialog(initialMode) {
    var dialog = document.getElementById('dlg');
    if (!configured()) {
      dialog.classList.remove('account-dialog-container');
      window.open('<h2>Conta PlacarUai</h2><p>Configure a URL do projeto Supabase e a chave publishable em <code>supabase-client-config.js</code> para ativar contas.</p>', 'Fechar', null, false);
      return;
    }
    if (currentUser) {
      dialog.classList.remove('account-dialog-container');
      dialog.innerHTML = '<h2>Sua conta</h2><p>Conectado como <b>' +
        window.esc(currentUser.email || '') + '</b>.</p><p class="hint">Carregando os dados da conta...</p>';
      dialog.showModal();
      loadSubscription().then(async function (subscription) {
        await checkManagement();
        if (!dialog.open) return;
        var active = canManage && subscription &&
          new Date(subscription.current_period_end).getTime() > Date.now();
        dialog.innerHTML = '<h2>Sua conta</h2><p>Conectado como <b>' +
          window.esc(currentUser.email || '') + '</b>.</p><p class="hint">' +
          (active
            ? 'Assinatura ativa até ' + new Date(subscription.current_period_end).toLocaleDateString('pt-BR') + '.'
            : 'Sem assinatura ativa. O histórico permanece disponível para consulta.') +
          '</p><div class="row"><button id="accountClose">Fechar</button>' +
          (active && subscription.status !== 'cancelled'
            ? '<button id="cancelPlan">Cancelar renovação</button>'
            : active
            ? '<span>Renovação cancelada; acesso até o fim do período.</span>'
            : '<button id="newPlan" class="go">Assinar · R$ 49,90/mês</button>') +
          '<button id="accountSignOut">Sair</button></div>';
        dialog.showModal();
        dialog.querySelector('#accountClose').onclick = function () { dialog.close(); };
        dialog.querySelector('#accountSignOut').onclick = async function () {
          var result = await client.auth.signOut();
          if (result.error) {
            console.error('Unable to sign out', result.error);
            report('Não foi possível sair da conta.');
          } else dialog.close();
        };
        var newPlan = dialog.querySelector('#newPlan');
        if (newPlan) newPlan.onclick = startCheckout;
        var cancelPlan = dialog.querySelector('#cancelPlan');
        if (cancelPlan) cancelPlan.onclick = async function () {
          if (!window.confirm('Confirma o cancelamento da renovação automática? O acesso pago permanece até o fim do período vigente.')) return;
          var result;
          try {
            result = await client.functions.invoke('cancel-subscription', { body: {} });
          } catch (error) {
            console.error('Subscription cancellation failed', error);
            report('Não foi possível cancelar a renovação. Verifique a conexão e tente novamente.');
            return;
          }
          if (result.error) {
            console.error('Subscription cancellation failed', result.error);
            report('Não foi possível cancelar a renovação.');
          } else {
            dialog.close();
            await checkManagement();
            window.renderProfile();
            report('Renovação cancelada. O acesso continua até o fim do período pago.');
          }
        };
      }).catch(function (error) {
        console.error('Unable to load account subscription', error);
        if (!dialog.open) return;
        dialog.innerHTML = '<h2>Sua conta</h2><p>Conectado como <b>' +
          window.esc(currentUser.email || '') + '</b>.</p>' +
          '<p class="account-dialog-message error">Não foi possível carregar a situação da assinatura. Verifique a conexão e tente novamente.</p>' +
          '<div class="row"><button id="accountRetry">Tentar novamente</button><button id="accountClose">Fechar</button></div>';
        dialog.querySelector('#accountRetry').onclick = function () {
          dialog.close();
          showAccountDialog();
        };
        dialog.querySelector('#accountClose').onclick = function () { dialog.close(); };
      });
      return;
    }

    dialog.classList.add('account-dialog-container');
    dialog.innerHTML =
      '<div class="account-dialog">' +
      '<div class="account-dialog-header"><div><p class="account-dialog-eyebrow">PLACARUAI</p>' +
      '<h2 id="authTitle">Acesse sua conta</h2>' +
      '<p id="authDescription" class="account-dialog-copy">Entre para acessar seu perfil e histórico.</p></div>' +
      '<button id="authClose" class="account-dialog-close" type="button" aria-label="Fechar">&times;</button></div>' +
      '<div class="account-mode" role="group" aria-label="Ação da conta">' +
      '<button id="authSignInMode" type="button" aria-pressed="true">Entrar</button>' +
      '<button id="authSignUpMode" type="button" aria-pressed="false">Criar conta</button></div>' +
      '<div class="account-fields">' +
      '<label id="authDisplayNameField" class="account-field" for="authDisplayName" hidden>Nome exibido' +
      '<input id="authDisplayName" class="account-control" type="text" autocomplete="name" maxlength="60" required></label>' +
      '<label class="account-field" for="authEmail">E-mail' +
      '<input id="authEmail" class="account-control" type="email" autocomplete="email" placeholder="voce@exemplo.com" required></label>' +
      '<label class="account-field" for="authPassword">Senha' +
      '<input id="authPassword" class="account-control" type="password" autocomplete="current-password" minlength="8" placeholder="Mínimo de 8 caracteres" required></label>' +
      '</div><div id="authSignupProfileFields" class="account-signup-fields" hidden>' +
      '<label class="account-field" for="authPhone">Telefone (privado)' +
      '<input id="authPhone" class="account-control" type="tel" autocomplete="tel" inputmode="tel" pattern="[0-9+() .-]{8,20}" maxlength="20" placeholder="(31) 99999-9999"></label>' +
      '<label class="account-field" for="authCity">Cidade' +
      '<input id="authCity" class="account-control" type="text" autocomplete="address-level2" maxlength="60" placeholder="Sua cidade"></label>' +
      '<label class="account-field" for="authState">Estado' +
      '<select id="authState" class="account-control" autocomplete="address-level1"></select></label>' +
      '<label class="account-field" for="authSport">Modalidade que pratica' +
      '<select id="authSport" class="account-control"><option value="">Selecione</option><option value="volei">Vôlei</option><option value="futevolei">Futevôlei</option><option value="beach">Beach tennis</option></select></label>' +
      '</div><label class="account-remember" for="authRememberSession">' +
      '<input id="authRememberSession" type="checkbox">' +
      '<span>Permanecer conectado neste dispositivo<small>Desative em aparelhos compartilhados.</small></span></label>' +
      '<div class="account-dialog-actions">' +
      '<button id="authSubmit" class="account-dialog-action primary" type="button">Entrar</button>' +
      '<button id="authGoogle" class="account-dialog-action google" type="button">' +
      '<span class="google-mark" aria-hidden="true">G</span>Continuar com Google</button></div>' +
      '<div class="account-dialog-footer"><button id="authForgot" class="account-dialog-link" type="button">Esqueci minha senha</button>' +
      '<button id="authModeToggle" class="account-dialog-link" type="button">Criar conta grátis</button>' +
      '<button id="authResend" class="account-dialog-link" type="button" hidden>Reenviar link de confirmação</button></div>' +
      '<p id="authError" class="account-dialog-message" role="status" aria-live="polite"></p></div>';
    dialog.showModal();
    var authMode = 'signin';
    var displayNameField = dialog.querySelector('#authDisplayNameField');
    var displayNameInput = dialog.querySelector('#authDisplayName');
    var signupProfileFields = dialog.querySelector('#authSignupProfileFields');
    var phoneInput = dialog.querySelector('#authPhone');
    var cityInput = dialog.querySelector('#authCity');
    var stateInput = dialog.querySelector('#authState');
    var sportInput = dialog.querySelector('#authSport');
    stateInput.innerHTML = '<option value="">Selecione</option>' +
      window.PLACARUAI_BRAZIL_STATES.map(function (state) {
        return '<option value="' + state[0] + '">' + window.esc(state[1]) + '</option>';
      }).join('');
    var emailInput = dialog.querySelector('#authEmail');
    var passwordInput = dialog.querySelector('#authPassword');
    var rememberSessionInput = dialog.querySelector('#authRememberSession');
    var authSubmit = dialog.querySelector('#authSubmit');
    var authStorage = window.placaruaiAuthStorage;
    rememberSessionInput.checked = authStorage ? authStorage.isRemembered() : true;
    rememberSessionInput.onchange = function () {
      if (!authStorage) {
        dialog.querySelector('#authError').textContent =
          'A opção de permanência da sessão está indisponível. Recarregue a página.';
        return;
      }
      try {
        authStorage.setRemembered(rememberSessionInput.checked);
      } catch (error) {
        console.error('Unable to update session persistence', error);
        rememberSessionInput.checked = authStorage.isRemembered();
        dialog.querySelector('#authError').textContent =
          'Não foi possível alterar a permanência da sessão neste dispositivo.';
      }
    };
    function setAuthMode(mode) {
      authMode = mode;
      var signingUp = mode === 'signup';
      displayNameField.hidden = !signingUp;
      displayNameInput.required = signingUp;
      signupProfileFields.hidden = !signingUp;
      phoneInput.required = signingUp;
      cityInput.required = signingUp;
      stateInput.required = signingUp;
      sportInput.required = signingUp;
      passwordInput.autocomplete = signingUp ? 'new-password' : 'current-password';
      authSubmit.textContent = signingUp ? 'Criar conta grátis' : 'Entrar';
      dialog.querySelector('#authGoogle').hidden = signingUp;
      dialog.querySelector('#authForgot').hidden = signingUp;
      dialog.querySelector('#authTitle').textContent = signingUp ? 'Crie sua conta' : 'Acesse sua conta';
      dialog.querySelector('#authDescription').textContent = signingUp
        ? 'Preencha seus dados esportivos para criar seu perfil automaticamente. Seu telefone é privado.'
        : 'Entre para acessar seu perfil e histórico.';
      dialog.querySelector('#authSignInMode').setAttribute('aria-pressed', String(!signingUp));
      dialog.querySelector('#authSignUpMode').setAttribute('aria-pressed', String(signingUp));
      dialog.querySelector('#authModeToggle').textContent = signingUp ? 'Já tenho uma conta' : 'Criar conta grátis';
      dialog.querySelector('#authResend').hidden = true;
      dialog.querySelector('#authError').textContent = '';
    }
    dialog.querySelector('#authSignInMode').onclick = function () { setAuthMode('signin'); };
    dialog.querySelector('#authSignUpMode').onclick = function () { setAuthMode('signup'); };
    dialog.querySelector('#authModeToggle').onclick = function () {
      setAuthMode(authMode === 'signin' ? 'signup' : 'signin');
    };
    setAuthMode(initialMode === 'signup' ? 'signup' : 'signin');
    dialog.querySelector('#authClose').onclick = function () { dialog.close(); };
    authSubmit.onclick = async function () {
      var email = emailInput.value.trim().toLowerCase();
      var password = passwordInput.value;
      var errorElement = dialog.querySelector('#authError');
      var signingUp = authMode === 'signup';
      if (!/^\S+@\S+\.\S+$/.test(email) || password.length < 8 ||
        signingUp && (!displayNameInput.value.trim() ||
          !/^[0-9+() .-]{8,20}$/.test(phoneInput.value.trim()) ||
          !cityInput.value.trim() || !stateInput.value || !sportInput.value)) {
        errorElement.textContent = signingUp
          ? 'Informe nome, telefone válido, cidade, estado e modalidade, além de e-mail e senha com pelo menos 8 caracteres.'
          : 'Informe um e-mail válido e uma senha com pelo menos 8 caracteres.';
        return;
      }
      authSubmit.disabled = true;
      errorElement.textContent = signingUp ? 'Criando sua conta...' : 'Entrando...';
      var result;
      try {
        if (!authStorage) throw new Error('Session persistence storage is unavailable');
        authStorage.setRemembered(rememberSessionInput.checked);
        result = signingUp
          ? await (function () {
            var options = { data: {
              display_name: displayNameInput.value.trim(),
              phone: phoneInput.value.trim(),
              city: cityInput.value.trim(),
              state: stateInput.value,
              favorite: sportInput.value,
            } };
            var redirectUrl = authRedirectUrl('./PlacarUai.html');
            if (redirectUrl) options.emailRedirectTo = redirectUrl;
            return client.auth.signUp({ email: email, password: password, options: options });
          })()
          : await client.auth.signInWithPassword({ email: email, password: password });
      } catch (error) {
        console.error('Supabase authentication request failed', String(error));
        errorElement.textContent = 'Não foi possível autenticar. Tente novamente.';
        authSubmit.disabled = false;
        return;
      }
      if (result.error) {
        if (!signingUp && result.error.code === 'email_not_confirmed') {
          errorElement.textContent = 'Confirme seu e-mail antes de entrar em quadra. Você pode reenviar o link.';
          dialog.querySelector('#authResend').hidden = false;
        } else {
          errorElement.textContent = 'Não foi possível autenticar. Verifique os dados e tente novamente.';
        }
        console.error('Supabase authentication failed', result.error.code);
        authSubmit.disabled = false;
        return;
      }
      if (!result.data.session) {
        errorElement.textContent = 'Enviamos um link de confirmação para o seu e-mail. Confirme para entrar em quadra!';
        dialog.querySelector('#authResend').hidden = false;
        authSubmit.disabled = false;
        return;
      }
      dialog.close();
    };
    [displayNameInput, emailInput, passwordInput].forEach(function (input) {
      input.addEventListener('keydown', function (event) {
        if (event.key === 'Enter') {
          event.preventDefault();
          authSubmit.click();
        }
      });
    });
    dialog.querySelector('#authGoogle').onclick = async function () {
      var button = this;
      var errorElement = dialog.querySelector('#authError');
      button.disabled = true;
      errorElement.textContent = 'Conectando com o Google...';
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
        if (result.error) throw result.error;
      } catch (error) {
        console.error('Google sign-in failed', error.code || String(error));
        errorElement.textContent = 'Login Google indisponível. Verifique se o provedor está configurado no Supabase.';
        button.disabled = false;
      }
    };
    dialog.querySelector('#authForgot').onclick = async function () {
      var email = emailInput.value.trim().toLowerCase();
      var errorElement = dialog.querySelector('#authError');
      if (!/^\S+@\S+\.\S+$/.test(email)) {
        errorElement.textContent = 'Informe um e-mail válido para receber o link de recuperação.';
        emailInput.focus();
        return;
      }
      var button = this;
      button.disabled = true;
      errorElement.textContent = 'Enviando solicitação de recuperação...';
      try {
        var recoveryOptions = {};
        var recoveryRedirectUrl = authRedirectUrl('./index.html?recovery=1');
        if (recoveryRedirectUrl) recoveryOptions.redirectTo = recoveryRedirectUrl;
        var result = await client.auth.resetPasswordForEmail(email, recoveryOptions);
        if (result.error) throw result.error;
        errorElement.textContent = 'Se esse e-mail estiver cadastrado, você receberá um link para redefinir a senha.';
      } catch (error) {
        console.error('Password recovery request failed', error.code || String(error));
        errorElement.textContent = 'Não foi possível enviar o link. Tente novamente.';
      } finally {
        button.disabled = false;
      }
    };
    dialog.querySelector('#authResend').onclick = async function () {
      var button = this;
      var email = emailInput.value.trim().toLowerCase();
      var errorElement = dialog.querySelector('#authError');
      if (!/^\S+@\S+\.\S+$/.test(email)) {
        errorElement.textContent = 'Informe um e-mail válido para reenviar o link de confirmação.';
        emailInput.focus();
        return;
      }
      button.disabled = true;
      errorElement.textContent = 'Enviando solicitação...';
      try {
        var resendOptions = {};
        var resendRedirectUrl = authRedirectUrl('./PlacarUai.html');
        if (resendRedirectUrl) resendOptions.emailRedirectTo = resendRedirectUrl;
        var result = await client.auth.resend({
          type: 'signup',
          email: email,
          options: resendOptions,
        });
        if (result.error) throw result.error;
        errorElement.textContent = 'Se houver um cadastro pendente para esse e-mail, enviaremos um novo link.';
      } catch (error) {
        console.error('Confirmation email resend failed', error.code || String(error));
        errorElement.textContent = 'Não foi possível reenviar o link. Tente novamente mais tarde.';
      } finally {
        button.disabled = false;
      }
    };
  }

  function renderProfile() {
    renderHeaderAccount();
    if (!currentUser) {
      window.athleteAccount = null;
      if (legacyRenderProfile) legacyRenderProfile();
      var el = document.getElementById('profile');
      if (el && !configured()) {
        var note = document.createElement('p');
        note.className = 'hint';
        note.textContent = 'Autenticação indisponível: configure primeiro o Supabase.';
        el.querySelector('.profile-wrap')?.appendChild(note);
      }
      addPublicBrowseControl();
      if (window.renderSocialProfile) window.renderSocialProfile();
      return;
    }
    var localProfile = window.ld(PKEY, null);
    var ownsLocalProfile = localProfile && (
      !localProfile.ownerEmail ||
      String(localProfile.ownerEmail).toLowerCase() === String(currentUser.email || '').toLowerCase()
    );
    var importedProfile = currentProfile && currentProfile.profile_data;
    var athleteProfile = ownsLocalProfile
      ? clone(localProfile)
      : importedProfile && Object.keys(importedProfile).length
      ? clone(importedProfile)
      : {};
    var registrationProfile = signupProfileFromMetadata(currentUser.user_metadata);
    var sourceProfile = importedProfile && typeof importedProfile === 'object'
      ? importedProfile
      : {};
    ['name', 'phone', 'city', 'state', 'favorite'].forEach(function (key) {
      if (!athleteProfile[key] && sourceProfile[key]) athleteProfile[key] = sourceProfile[key];
      if (!athleteProfile[key] && registrationProfile[key]) athleteProfile[key] = registrationProfile[key];
    });
    athleteProfile.ownerEmail = currentUser.email || '';
    window.athlete = Object.keys(athleteProfile).some(function (key) {
      return key !== 'ownerEmail';
    }) ? athleteProfile : null;
    if (window.athlete && window.sv) window.sv(PKEY, window.athlete);
    window.athleteMatches = window.ld(LKEY, []).filter(function (match) {
      return !match.email ||
        String(match.email).toLowerCase() === String(currentUser.email || '').toLowerCase();
    });
    window.athleteAccount = {
      email: currentUser.email || '',
      userId: currentUser.id,
      uaId: currentProfile && currentProfile.public_id || '',
    };
    if (legacyRenderProfile) legacyRenderProfile();
    addPublicBrowseControl();
    if (window.renderSocialProfile) window.renderSocialProfile();
  }

  async function syncSession(session) {
    currentUser = session && session.user || null;
    currentProfile = null;
    canManage = false;
    remoteTournaments = [];
    window.placaruaiCanManage = false;
    if (!currentUser) {
      window.athleteAccount = null;
      window.athlete = null;
      window.athleteMatches = [];
      localStorage.removeItem(AKEY);
    }
    if (currentUser) {
      var result = await client.from('profiles')
        .select('user_id, public_id, email, display_name, account_status, profile_data')
        .eq('user_id', currentUser.id)
        .maybeSingle();
      if (result.error) {
        console.error('Unable to load current profile', result.error.code);
        report('Não foi possível carregar o perfil da conta.');
      } else {
        currentProfile = result.data;
      }
      if (currentProfile) {
        var savedProfile = currentProfile.profile_data &&
          typeof currentProfile.profile_data === 'object' &&
          !Array.isArray(currentProfile.profile_data)
          ? currentProfile.profile_data
          : {};
        var profileFromSignup = signupProfileFromMetadata(currentUser.user_metadata);
        var hydratedProfile = clone(savedProfile);
        var profileChanged = false;
        Object.keys(profileFromSignup).forEach(function (key) {
          if (!String(hydratedProfile[key] || '').trim()) {
            hydratedProfile[key] = profileFromSignup[key];
            profileChanged = true;
          }
        });
        var displayName = currentProfile.display_name ||
          profileFromSignup.name ||
          savedProfile.name ||
          '';
        if (profileChanged || !currentProfile.display_name && displayName) {
          var updateResult = await client.from('profiles')
            .update({
              display_name: String(displayName).slice(0, 80),
              profile_data: hydratedProfile,
            })
            .eq('user_id', currentUser.id)
            .select('user_id, public_id, email, display_name, account_status, profile_data')
            .maybeSingle();
          if (updateResult.error) {
            console.error('Unable to save profile details collected during signup', updateResult.error.code);
            report('Não foi possível salvar automaticamente os dados do cadastro no perfil. Você pode preenchê-los em Editar perfil.');
            currentProfile.profile_data = hydratedProfile;
          } else if (updateResult.data) {
            currentProfile = updateResult.data;
          }
        }
      }
      var historyResult = await client.from('match_history')
        .select('id, match_data')
        .eq('user_id', currentUser.id)
        .order('played_at', { ascending: false })
        .limit(500);
      if (historyResult.error) {
        console.error('Unable to load private match history', historyResult.error.code);
        report('Não foi possível carregar o histórico da nuvem. O histórico local pode não conter todas as partidas.');
      } else {
        var matchesById = new Map();
        window.ld(LKEY, []).filter(function (match) {
          return match && typeof match === 'object' &&
            (!match.email || String(match.email).toLowerCase() ===
              String(currentUser.email || '').toLowerCase());
        }).forEach(function (match) {
          if (!match.email) match.email = currentUser.email || '';
          matchesById.set(String(match.id), match);
        });
        (historyResult.data || []).forEach(function (row) {
          var match = row.match_data;
          match.id = row.id;
          match.email = currentUser.email || '';
          matchesById.set(String(row.id), match);
        });
        window.athleteMatches = Array.from(matchesById.values()).sort(function (a, b) {
          return Date.parse(b.at || b.localDate || '') - Date.parse(a.at || a.localDate || '');
        });
        localStorage.setItem(LKEY, JSON.stringify(window.athleteMatches));
      }
      try {
        await checkManagement();
      } catch (error) {
        console.error('Unable to verify current subscription', error);
      }
    }
    window.renderProfile();
    if (currentUser && window.pendingAuthenticatedTab &&
      ['history', 'profile'].indexOf(window.pendingAuthenticatedTab) >= 0) {
      var pendingTab = window.pendingAuthenticatedTab;
      window.pendingAuthenticatedTab = '';
      if (window.activateAuthenticatedTab) window.activateAuthenticatedTab(pendingTab);
    }
  }

  function requireSocialSession() {
    if (!client || !currentUser) {
      throw new Error('Entre na sua conta para usar os recursos sociais.');
    }
  }

  async function socialRpc(name, args) {
    requireSocialSession();
    var result = await client.rpc(name, args || {});
    if (result.error) throw result.error;
    return result.data;
  }

  function publicMatchActivity(match) {
    function team(source) {
      source = source && typeof source === 'object' ? source : {};
      return {
        name: String(source.name || '').slice(0, 60),
        pts: Math.max(0, Number(source.pts) || 0),
        games: Math.max(0, Number(source.games) || 0),
        sets: Math.max(0, Number(source.sets) || 0),
      };
    }
    return {
      at: match.at,
      mod: String(match.mod || '').slice(0, 30),
      A: team(match.A),
      B: team(match.B),
      scoreText: String(match.scoreText || '').slice(0, 80),
      hs: Array.isArray(match.hs) ? match.hs.slice(0, 20) : [],
      result: ['win', 'loss', 'unrated'].indexOf(match.result) >= 0
        ? match.result
        : 'unrated',
      venue: String(match.venue || '').slice(0, 70),
      partner: String(match.partner || '').slice(0, 50),
    };
  }

  async function updateAthleteProfile(profile) {
    requireSocialSession();
    var safeProfile = clone(profile);
    safeProfile.ownerEmail = currentUser.email || '';
    var result = await client.from('profiles')
      .update({
        display_name: String(safeProfile.name || '').slice(0, 80),
        profile_data: safeProfile,
      })
      .eq('user_id', currentUser.id)
      .select('user_id, public_id, display_name, account_status, profile_data')
      .maybeSingle();
    if (result.error) throw result.error;
    if (!result.data) throw new Error('O perfil da conta não foi encontrado.');
    currentProfile = result.data;
    renderHeaderAccount();
    return currentProfile.public_id;
  }

  window.placaruaiSocialApi = {
    ready: function () { return !!client && !!currentUser; },
    publicId: function () { return currentProfile && currentProfile.public_id || ''; },
    searchProfiles: function (query) {
      return socialRpc('search_athlete_profiles', { p_query: query, p_limit: 20 });
    },
    getProfile: function (publicId) {
      return socialRpc('get_athlete_profile_social_v2', { p_public_id: publicId }).catch(function (error) {
        if (!error || ['PGRST202', '42883'].indexOf(String(error.code || '')) < 0) throw error;
        return socialRpc('get_athlete_profile', { p_public_id: publicId }).then(function (data) {
          var profiles = Array.isArray(data) ? data : data ? [data] : [];
          return profiles.map(function (profile) {
            return Object.assign({}, profile, {
              state_code: '',
              following_count: Number(profile.craques_count) || 0,
              followers_count: Number(profile.arquibancada_count) || 0,
              win_percentage: null,
              followers_hidden: false,
            });
          });
        });
      });
    },
    listConnections: function (publicId, relation) {
      return socialRpc('list_athlete_connections_social_v2', {
        p_public_id: publicId,
        p_relation: relation,
        p_limit: 50,
      }).catch(function (error) {
        // The legacy RPC can safely provide the "following" list. Do not use
        // it for followers: it predates the hidden-followers privacy setting.
        if (relation !== 'following' || !error ||
          ['PGRST202', '42883'].indexOf(String(error.code || '')) < 0) throw error;
        return socialRpc('list_athlete_connections', {
          p_public_id: publicId,
          p_relation: 'craques',
          p_limit: 50,
        }).then(function (data) {
          var people = Array.isArray(data) ? data : data ? [data] : [];
          return people.map(function (person) {
            return Object.assign({}, person, {
              state_code: '',
              win_percentage: null,
            });
          });
        });
      });
    },
    getProfileReviews: function (publicId) {
      return socialRpc('get_athlete_profile_reviews', { p_public_id: publicId });
    },
    submitProfileReview: function (publicId, rating, comment) {
      return socialRpc('submit_athlete_profile_review', {
        p_target_public_id: publicId,
        p_rating: rating,
        p_comment: comment,
      });
    },
    moderateProfileReview: function (reviewId, action) {
      return socialRpc('moderate_athlete_profile_review', {
        p_review_id: reviewId,
        p_action: action,
      });
    },
    setProfileReviewsHidden: function (hidden) {
      return socialRpc('set_athlete_profile_reviews_hidden', { p_hidden: hidden });
    },
    follow: function (publicId, following) {
      return socialRpc('set_athlete_follow', {
        p_target_public_id: publicId,
        p_following: following,
      });
    },
    submitMatch: function (match, inviteePublicIds) {
      var playedAt = match.at && !Number.isNaN(Date.parse(match.at))
        ? new Date(match.at).toISOString()
        : new Date().toISOString();
      return socialRpc('submit_social_match', {
        p_activity: publicMatchActivity(match),
        p_invitee_public_ids: Array.isArray(inviteePublicIds) ? inviteePublicIds : [],
        p_played_at: playedAt,
      }).then(function (matchId) {
        var localMatches = window.ld(LKEY, []);
        var localId = match.id;
        var localMatch = localMatches.find(function (item) {
          return String(item.id) === String(localId);
        });
        if (localMatch) localMatch.id = matchId;
        match.id = matchId;
        window.athleteMatches = localMatches;
        localStorage.setItem(LKEY, JSON.stringify(localMatches));
        return matchId;
      });
    },
    respondToMatch: function (matchId, decision) {
      return socialRpc('respond_to_social_match', {
        p_match_id: matchId,
        p_decision: decision,
      });
    },
    followedActivities: function () {
      return socialRpc('get_followed_activities', { p_limit: 50 });
    },
    notifications: function () {
      return socialRpc('get_social_notifications', { p_limit: 50 });
    },
    markNotificationsRead: function () {
      return socialRpc('mark_social_notifications_read');
    },
    updateProfile: updateAthleteProfile,
  };

  async function openTournamentModule() {
    var dialog = document.getElementById('tourDialog');
    dialog.showModal();
    if (!client) {
      dialog.close();
      showAccountDialog('signin');
      return;
    }
    var sessionResult = await client.auth.getSession();
    if (sessionResult.error) {
      console.error('Unable to validate current session', sessionResult.error);
      dialog.innerHTML =
        '<div class="tour-shell"><div class="tour-head"><div><h2>Meus campeonatos</h2></div>' +
        '<button class="tour-close" aria-label="Fechar">Fechar</button></div>' +
        '<div class="tour-body"><p class="tour-muted">Não foi possível verificar sua sessão. Entre novamente e tente abrir os campeonatos.</p>' +
        '<button id="retryTournamentLibrary">Tentar novamente</button></div></div>';
      dialog.querySelector('.tour-close').onclick = function () { dialog.close(); };
      dialog.querySelector('#retryTournamentLibrary').onclick = function () { openTournamentModule(); };
      return;
    }
    currentUser = sessionResult.data.session && sessionResult.data.session.user || null;
    if (!currentUser) {
      dialog.close();
      showAccountDialog('signin');
      return;
    }
    try {
      await Promise.all([checkManagement(), loadOwnedTournaments()]);
    } catch (error) {
      console.error('Unable to load account tournament data', error);
      dialog.innerHTML =
        '<div class="tour-shell"><div class="tour-head"><div><h2>Meus campeonatos</h2></div>' +
        '<button class="tour-close" aria-label="Fechar">Fechar</button></div>' +
        '<div class="tour-body"><p class="tour-muted">Não foi possível carregar seus campeonatos. Verifique a conexão e tente novamente.</p>' +
        '<button id="retryTournamentLibrary">Tentar novamente</button></div></div>';
      dialog.querySelector('.tour-close').onclick = function () { dialog.close(); };
      dialog.querySelector('#retryTournamentLibrary').onclick = function () { openTournamentModule(); };
      return;
    }
    if (canManage) {
      window.renderTourManager();
    } else {
      showTournamentLibrary();
    }
  }

  function tours() {
    return remoteTournaments;
  }

  function saveTours(list) {
    remoteTournaments = clone(list);
    saveQueue = saveQueue.catch(function (error) {
      console.error('Previous tournament save failed before retrying queued changes', error);
    }).then(function () {
      return persistTournamentList(remoteTournaments);
    }).catch(function (error) {
      console.error('Tournament save failed unexpectedly', error);
      report('Não foi possível salvar as alterações do campeonato. Verifique a conexão e tente novamente.');
    });
    return saveQueue;
  }

  function getTour() {
    return remoteTournaments.find(function (tournament) {
      return tournament.id === window.currentTourId;
    });
  }

  function extendTournamentManager() {
    var original = window.renderTourManager;
    window.renderTourManager = function () {
      original();
      var tournament = getTour();
      var body = document.querySelector('#tourDialog .tour-body');
      if (!tournament || !body || body.querySelector('#publicTournamentToggle')) return;
      var publication = document.createElement('div');
      publication.className = 'tour-panel';
      publication.innerHTML =
        '<div class="tour-title">Consulta pública</div><p class="tour-muted">' +
        (tournament.is_published
          ? 'Este campeonato está publicado para consulta gratuita.'
          : 'Publique para permitir consulta pública gratuita de resultados e classificações.') +
        '</p><button id="publicTournamentToggle">' +
        (tournament.is_published ? 'Retirar publicação' : 'Publicar campeonato') +
        '</button>' +
        (tournament.is_published
          ? ' <a href="./campeonatos.html?id=' + encodeURIComponent(tournament.id) +
            '&organizer=' + encodeURIComponent(currentUser.id) +
            '" target="_blank" rel="noopener">Abrir consulta pública</a>'
          : '') +
        '</div>';
      body.prepend(publication);
      publication.querySelector('#publicTournamentToggle').onclick = async function () {
        if (!canManage || !currentUser) {
          report('A assinatura ativa é validada pelo servidor antes de alterar a publicação.');
          return;
        }
        var result;
        try {
          result = await client.from('tournaments')
            .update({ is_published: !tournament.is_published })
            .eq('organizer_id', currentUser.id)
            .eq('id', tournament.id);
        } catch (error) {
          console.error('Tournament publication update failed', error);
          report('Não foi possível alterar a publicação. Verifique a conexão e tente novamente.');
          return;
        }
        if (result.error) {
          console.error('Tournament publication update rejected', result.error.code);
          report('Não foi possível alterar a publicação.');
          return;
        }
        tournament.is_published = !tournament.is_published;
        await loadOwnedTournaments();
        window.renderTourManager();
      };
    };
  }

  window.openAccount = showAccountDialog;
  window.renderProfile = renderProfile;
  window.openTournamentModule = openTournamentModule;
  window.renderTourGate = function () {
    showGate('A autorização de gerenciamento e a consulta de histórico são verificadas pelo Supabase.');
  };
  window.tourAllowed = function () { return canManage; };
  window.tours = tours;
  window.saveTours = saveTours;
  window.getTour = getTour;

  renderHeaderAccount();

  if (configured() && window.supabase && typeof window.supabase.createClient === 'function') {
    client = window.supabase.createClient(config.url, config.publishableKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
        storage: window.placaruaiAuthStorage && window.placaruaiAuthStorage.storage,
      },
    });
    window.placaruaiSupabaseClient = client;
    extendTournamentManager();
    client.auth.onAuthStateChange(function (_event, session) {
      window.setTimeout(function () {
        syncSession(session).catch(function (error) {
          console.error('Unable to apply Supabase session', error);
          report('Não foi possível atualizar a sessão. Recarregue a página.');
        });
      }, 0);
    });
    client.auth.getSession().then(function (result) {
      if (result.error) throw result.error;
      return syncSession(result.data.session);
    }).then(function () {
      if (!currentUser &&
        new URLSearchParams(window.location.search).get('auth') === 'required') {
        showAccountDialog('signin');
      }
    }).catch(function (error) {
      console.error('Unable to restore Supabase session', error);
      report('Não foi possível restaurar a sessão. Entre novamente.');
    });
  } else {
    window.placaruaiSupabaseClient = null;
    window.athleteAccount = null;
    window.athlete = null;
    window.athleteMatches = [];
    if (!window.supabase || typeof window.supabase.createClient !== 'function') {
      console.error('Supabase JavaScript client did not load');
    }
    window.renderProfile();
  }
})();
