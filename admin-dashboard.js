(function () {
  'use strict';

  var config = window.PLACARUAI_SUPABASE_CONFIG || {};
  var client = null;
  var currentSection = 'overview';
  var userPage = 0;
  var currentSearch = '';

  var login = document.getElementById('login');
  var dashboard = document.getElementById('dashboard');
  var message = document.getElementById('dashboardError');
  var panel = document.getElementById('sectionPanel');
  var overview = document.getElementById('overview');

  function escapeHtml(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, function (char) {
      return {
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
      }[char];
    });
  }

  function setError(text) {
    message.textContent = text || '';
  }

  function isConfigured() {
    return typeof config.url === 'string' &&
      /^https:\/\/[a-z0-9-]+\.supabase\.co$/i.test(config.url) &&
      typeof config.publishableKey === 'string' &&
      config.publishableKey.startsWith('sb_publishable_');
  }

  function range() {
    var now = new Date();
    var from = new Date(now);
    var period = document.getElementById('period').value;
    if (period === 'today') from.setHours(0, 0, 0, 0);
    else if (period === '7d') from.setDate(from.getDate() - 7);
    else if (period === '30d') from.setDate(from.getDate() - 30);
    else if (period === 'month') from = new Date(now.getFullYear(), now.getMonth(), 1);
    else {
      var fromDate = document.getElementById('fromDate').value;
      var toDate = document.getElementById('toDate').value;
      if (!fromDate || !toDate) throw new Error('Selecione as datas do período personalizado.');
      from = new Date(fromDate + 'T00:00:00');
      now = new Date(toDate + 'T23:59:59.999');
      if (now < from) throw new Error('A data final deve ser posterior à data inicial.');
    }
    return { from: from.toISOString(), to: now.toISOString() };
  }

  async function invoke(body) {
    var result = await client.functions.invoke('admin-dashboard', { body: body });
    if (result.error) {
      var status = result.error.context && result.error.context.status;
      if (status === 403) throw new Error('A conta autenticada não possui permissão master.');
      if (status === 401) throw new Error('A sessão expirou. Entre novamente.');
      throw new Error('A API administrativa não respondeu. Verifique a configuração do Supabase.');
    }
    return result.data;
  }

  function money(value) {
    return Number(value || 0).toLocaleString('pt-BR', {
      style: 'currency', currency: 'BRL',
    });
  }

  function metric(label, value, note) {
    return '<article class="metric"><small>' + escapeHtml(label) +
      '</small><strong>' + escapeHtml(value) + '</strong>' +
      (note ? '<small>' + escapeHtml(note) + '</small>' : '') + '</article>';
  }

  function summaryTable(title, headers, rows) {
    if (!rows.length) return '<div class="panel"><h2>' + escapeHtml(title) + '</h2><p class="muted">Sem registros.</p></div>';
    return '<div class="panel"><h2>' + escapeHtml(title) + '</h2><table><thead><tr>' +
      headers.map(function (header) { return '<th>' + escapeHtml(header) + '</th>'; }).join('') +
      '</tr></thead><tbody>' + rows.map(function (row) {
        return '<tr>' + row.map(function (cell) {
          return '<td>' + escapeHtml(cell) + '</td>';
        }).join('') + '</tr>';
      }).join('') + '</tbody></table></div>';
  }

  function renderOverview(data) {
    var metrics = data.metrics || {};
    var users = metrics.users || {};
    var tournaments = metrics.tournaments || {};
    var subscriptions = metrics.subscriptions || {};
    var payments = metrics.payments || {};
    var integrity = metrics.integrity || {};
    overview.innerHTML = '<div class="grid">' +
      metric('Usuários cadastrados', users.total || 0, 'Ativos no período: ' + (users.active || 0)) +
      metric('Novos cadastros', users.new || 0) +
      metric('Campeonatos', tournaments.total || 0, 'Criados no período: ' + (tournaments.created || 0)) +
      metric('Em andamento', tournaments.in_progress || 0) +
      metric('Concluídos', tournaments.completed || 0) +
      metric('Assinaturas ativas', subscriptions.active || 0) +
      metric('Assinaturas vencidas', subscriptions.expired || 0) +
      metric('Assinaturas canceladas', subscriptions.cancelled || 0) +
      metric('Assinaturas pendentes', subscriptions.pending || 0) +
      metric('Pagamentos confirmados', payments.confirmed || 0) +
      metric('Pagamentos pendentes', payments.pending || 0) +
      metric('Pagamentos recusados', payments.rejected || 0) +
      metric('Receita bruta confirmada', money(payments.gross_confirmed), 'Somente pagamentos aprovados') +
      metric('Reembolsos confirmados', money(payments.refunded), 'Taxas e lucro líquido não estimados') +
      metric('Concluídos sem classificação', integrity.completed_without_classification || 0) +
      metric('Alertas técnicos não revisados', integrity.open_technical_events || 0) +
      '</div>' +
      summaryTable('Campeonatos recentes', ['Nome', 'Organizador', 'Status', 'Criado em'], (data.tournaments || []).map(function (row) {
        return [row.name, row.owner && (row.owner.display_name || row.owner.email) || row.organizer_id, row.status, new Date(row.created_at).toLocaleString('pt-BR')];
      })) +
      summaryTable('Pagamentos recentes', ['Usuário', 'Status', 'Valor', 'Confirmado em'], (data.payments || []).map(function (row) {
        return [row.owner && (row.owner.display_name || row.owner.email) || row.user_id, row.status, money(row.amount), row.paid_at ? new Date(row.paid_at).toLocaleString('pt-BR') : '—'];
      }));
  }

  function renderUsers(users, page) {
    panel.innerHTML = '<h2>Gestão de usuários</h2><p class="muted">Busca por nome público, e-mail ou identificador. E-mails são exibidos somente na área master.</p>' +
      '<div class="filters"><input id="userSearch" type="search" maxlength="100" placeholder="Nome, e-mail ou ID" value="' + escapeHtml(currentSearch) + '">' +
      '<button id="searchUsers" class="primary">Pesquisar</button></div>' +
      '<table><thead><tr><th>Nome</th><th>ID</th><th>E-mail</th><th>Status</th><th>Cadastro</th><th>Último acesso</th></tr></thead><tbody>' +
      (users.length ? users.map(function (user) {
        return '<tr data-user-id="' + escapeHtml(user.user_id) + '">' +
          '<td>' + escapeHtml(user.display_name || '—') + '</td><td>' + escapeHtml(user.public_id || user.user_id) +
          '</td><td>' + escapeHtml(user.email) + '</td><td>' + escapeHtml(user.account_status) +
          '</td><td>' + new Date(user.created_at).toLocaleDateString('pt-BR') +
          '</td><td>' + (user.last_sign_in_at ? new Date(user.last_sign_in_at).toLocaleString('pt-BR') : '—') + '</td></tr>';
      }).join('') : '<tr><td colspan="6">Nenhum usuário encontrado.</td></tr>') +
      '</tbody></table><div class="pager"><button id="previousPage" ' + (page === 0 ? 'disabled' : '') + '>Anterior</button>' +
      '<span>Página ' + (page + 1) + '</span><button id="nextPage" ' + (users.length < 50 ? 'disabled' : '') + '>Próxima</button></div>' +
      '<div id="userDetail"></div>';
    panel.querySelector('#searchUsers').onclick = function () {
      currentSearch = panel.querySelector('#userSearch').value.trim();
      userPage = 0;
      loadUsers();
    };
    panel.querySelector('#userSearch').onkeydown = function (event) {
      if (event.key === 'Enter') panel.querySelector('#searchUsers').click();
    };
    panel.querySelector('#previousPage').onclick = function () {
      userPage = Math.max(0, userPage - 1);
      loadUsers();
    };
    panel.querySelector('#nextPage').onclick = function () {
      userPage += 1;
      loadUsers();
    };
    panel.querySelectorAll('[data-user-id]').forEach(function (row) {
      row.onclick = function () { loadUserDetail(row.dataset.userId); };
    });
  }

  async function loadUsers() {
    setError('');
    try {
      var result = await invoke({ action: 'users', search: currentSearch, page: userPage });
      renderUsers(result.users || [], result.page || 0);
    } catch (error) {
      setError(error.message);
    }
  }

  async function loadUserDetail(userId) {
    setError('');
    try {
      var detail = await invoke({ action: 'user_detail', userId: userId });
      var target = panel.querySelector('#userDetail');
      var profile = detail.profile || {};
      target.innerHTML = '<div class="panel"><h3>Detalhes do usuário</h3><div class="detail">' +
        '<p><b>Nome:</b> ' + escapeHtml(profile.display_name || '—') + '</p>' +
        '<p><b>E-mail:</b> ' + escapeHtml(profile.email || '—') + '</p>' +
        '<p><b>ID:</b> ' + escapeHtml(profile.user_id || '—') + '</p>' +
        '<p><b>Status da conta:</b> ' + escapeHtml(profile.account_status || '—') + '</p>' +
        '<p><b>Cadastro:</b> ' + (profile.created_at ? new Date(profile.created_at).toLocaleString('pt-BR') : '—') + '</p>' +
        '<p><b>Campeonatos:</b> ' + (detail.tournaments || []).length + '</p>' +
        '<p><b>Assinaturas:</b> ' + (detail.subscriptions || []).length + '</p>' +
        '<p><b>Pagamentos:</b> ' + (detail.payments || []).length + '</p></div>' +
        summaryTable('Assinaturas do usuário', ['Plano', 'Status', 'Valor', 'Vigência'], (detail.subscriptions || []).map(function (sub) {
          return [sub.plan_id, sub.status, money(sub.amount), sub.current_period_end ? new Date(sub.current_period_end).toLocaleDateString('pt-BR') : '—'];
        })) +
        summaryTable('Campeonatos do usuário', ['Nome', 'Status', 'Criado em', 'Participantes'], (detail.tournaments || []).map(function (tournament) {
          return [tournament.name, tournament.status, new Date(tournament.created_at).toLocaleDateString('pt-BR'), tournament.participant_count];
        })) + '</div>';
    } catch (error) {
      setError(error.message);
    }
  }

  async function loadSection(section) {
    currentSection = section;
    document.querySelectorAll('[data-section]').forEach(function (button) {
      button.setAttribute('aria-current', String(button.dataset.section === section));
    });
    setError('');
    if (section === 'overview') {
      panel.innerHTML = '<p class="muted">Os indicadores são carregados na Visão geral.</p>';
      return;
    }
    if (section === 'users') return loadUsers();
    if (section === 'monitoring') {
      try {
        var monitoring = await invoke({ action: 'monitoring' });
        var events = monitoring.events || [];
        panel.innerHTML = '<h2>Monitoramento e integridade</h2>' +
          '<div class="scroll"><table><thead><tr><th>Fonte</th><th>Evento</th><th>Severidade</th>' +
          '<th>Registro</th><th>Classificação</th><th>Detectado em</th><th>Revisão</th></tr></thead>' +
          '<tbody id="monitoringRows"></tbody></table></div>' +
          (!events.length ? '<p class="muted">Nenhum problema registrado.</p>' : '');
        var eventRows = panel.querySelector('#monitoringRows');
        events.forEach(function (event) {
          var row = document.createElement('tr');
          [
            event.source, event.event_type, event.severity, event.message,
            event.review_status === 'reviewed' ? 'Confirmado manualmente' : 'Detectado automaticamente',
            new Date(event.detected_at).toLocaleString('pt-BR'),
          ].forEach(function (value) {
            var cell = document.createElement('td');
            cell.textContent = String(value || '—');
            row.appendChild(cell);
          });
          var actionCell = document.createElement('td');
          if (event.review_status === 'reviewed') {
            actionCell.textContent = event.review_reason || 'Revisado';
          } else {
            var reviewButton = document.createElement('button');
            reviewButton.textContent = 'Revisar';
            reviewButton.onclick = async function () {
            var reason = window.prompt('Informe o motivo da revisão (mínimo 5 caracteres):');
            if (!reason) return;
            try {
              await invoke({
                action: 'review_event',
                eventId: Number(event.id),
                reason: reason,
              });
              await loadSection('monitoring');
              await loadOverview();
            } catch (error) {
              setError(error.message);
            }
          };
            actionCell.appendChild(reviewButton);
          }
          row.appendChild(actionCell);
          eventRows.appendChild(row);
        });
      } catch (error) {
        setError(error.message);
      }
      return;
    }
    var labels = {
      subscriptions: ['Usuário', 'Plano', 'Status', 'Valor mensal', 'Vencimento', 'ID do provedor'],
      tournaments: ['Nome', 'Organizador', 'Status', 'Publicação', 'Criado em', 'Participantes'],
      payments: ['Usuário', 'Status', 'Valor', 'Moeda', 'Confirmado em', 'ID do provedor'],
      monitoring: [],
      audit: ['Administrador', 'Ação', 'Registro', 'Resultado', 'Data'],
    };
    try {
      var result = await invoke({ action: section });
      var rows = result[section] || [];
      var values = rows.map(function (row) {
        if (section === 'subscriptions') return [
          row.owner && (row.owner.display_name || row.owner.email) || row.user_id,
          row.plan_id, row.status, money(row.amount),
          row.current_period_end ? new Date(row.current_period_end).toLocaleDateString('pt-BR') : '—',
          row.provider_subscription_id || '—',
        ];
        if (section === 'tournaments') return [
          row.name, row.owner && (row.owner.display_name || row.owner.email) || row.organizer_id,
          row.status, row.is_published ? 'Publicado' : 'Privado',
          new Date(row.created_at).toLocaleDateString('pt-BR'), row.participant_count,
        ];
        if (section === 'payments') return [
          row.owner && (row.owner.display_name || row.owner.email) || row.user_id,
          row.status, money(row.amount), row.currency,
          row.paid_at ? new Date(row.paid_at).toLocaleString('pt-BR') : '—',
          row.provider_payment_id,
        ];
        return [
          row.actor_id, row.action, row.entity_type + (row.entity_id ? ': ' + row.entity_id : ''),
          row.outcome, new Date(row.created_at).toLocaleString('pt-BR'),
        ];
      });
      panel.innerHTML = summaryTable({
        subscriptions: 'Assinaturas', tournaments: 'Campeonatos',
        payments: 'Pagamentos', audit: 'Auditoria',
      }[section], labels[section], values);
    } catch (error) {
      setError(error.message);
    }
  }

  async function loadOverview() {
    setError('');
    try {
      var period = range();
      var result = await invoke({
        action: 'overview',
        from: period.from,
        to: period.to,
      });
      renderOverview(result);
      await loadSection('overview');
      return true;
    } catch (error) {
      setError(error.message);
      return false;
    }
  }

  async function verifyMaster(session) {
    if (!session) {
      dashboard.classList.add('hidden');
      login.classList.remove('hidden');
      return;
    }
    document.getElementById('adminIdentity').textContent = session.user.email || '';
    login.classList.add('hidden');
    dashboard.classList.remove('hidden');
    var authorized = await loadOverview();
    if (!authorized) {
      dashboard.classList.add('hidden');
      login.classList.remove('hidden');
      document.getElementById('loginError').textContent =
        message.textContent || 'Acesso administrativo negado.';
    }
  }

  if (!isConfigured() || !window.supabase) {
    document.getElementById('loginError').textContent =
      'Configure o Supabase em supabase-client-config.js antes de acessar o painel.';
    document.getElementById('loginButton').disabled = true;
    return;
  }
  client = window.supabase.createClient(config.url, config.publishableKey, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
  });

  document.getElementById('loginButton').onclick = async function () {
    var result = await client.auth.signInWithPassword({
      email: document.getElementById('email').value.trim(),
      password: document.getElementById('password').value,
    });
    if (result.error) {
      document.getElementById('loginError').textContent = 'Não foi possível autenticar.';
      console.error('Master page sign-in failed', result.error.code);
      return;
    }
    try {
      await verifyMaster(result.data.session);
    } catch (error) {
      document.getElementById('loginError').textContent = error.message;
      await client.auth.signOut();
    }
  };
  document.getElementById('signOut').onclick = async function () {
    await client.auth.signOut();
    dashboard.classList.add('hidden');
    login.classList.remove('hidden');
  };
  document.getElementById('refresh').onclick = loadOverview;
  document.getElementById('period').onchange = function () {
    var custom = this.value === 'custom';
    document.getElementById('fromWrap').classList.toggle('hidden', !custom);
    document.getElementById('toWrap').classList.toggle('hidden', !custom);
  };
  document.querySelectorAll('[data-section]').forEach(function (button) {
    button.onclick = function () { loadSection(button.dataset.section); };
  });

  client.auth.onAuthStateChange(function (_event, session) {
    window.setTimeout(function () {
      verifyMaster(session).catch(function (error) {
        setError(error.message);
        login.classList.remove('hidden');
        dashboard.classList.add('hidden');
      });
    }, 0);
  });
  client.auth.getSession().then(function (result) {
    if (result.error) throw result.error;
    return verifyMaster(result.data.session);
  }).catch(function (error) {
    document.getElementById('loginError').textContent = 'Não foi possível restaurar a sessão.';
    console.error('Unable to restore master page session', error);
  });
})();
