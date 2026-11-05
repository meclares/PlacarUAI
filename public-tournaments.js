(function () {
  'use strict';

  var config = window.PLACARUAI_SUPABASE_CONFIG || {};
  var message = document.getElementById('message');
  var listElement = document.getElementById('list');
  var detailElement = document.getElementById('detail');
  var client = null;
  var tournaments = [];
  var requiresAccount = false;
  var refreshInProgress = false;
  var currentTournamentUser = null;
  var selectedTournamentId = null;
  var selectedTournamentIsDemo = false;
  var selectedTournamentSnapshot = '';
  var tournamentQuery = '';
  var tournamentFilter = 'all';
  var toolbar = document.querySelector('.toolbar');
  var searchInput = document.getElementById('tournamentSearch');

  if (searchInput) searchInput.addEventListener('input', function () {
    tournamentQuery = searchInput.value.trim().toLocaleLowerCase('pt-BR');
    renderList();
  });
  document.querySelectorAll('[data-filter]').forEach(function (button) {
    button.addEventListener('click', function () {
      tournamentFilter = button.dataset.filter;
      document.querySelectorAll('[data-filter]').forEach(function (filterButton) {
        filterButton.setAttribute('aria-pressed', String(filterButton === button));
      });
      renderList();
    });
  });

  function team(id, name1, name2) {
    return { id: id, name1: name1, name2: name2 };
  }

  function match(a, b, scoreA, scoreB, group) {
    return {
      a: a, b: b, scoreA: scoreA, scoreB: scoreB,
      winner: scoreA == null || scoreB == null ? null : scoreA > scoreB ? a : b,
      group: group,
    };
  }

  var demoTournaments = [
    {
      id: 'demo-volei-finalizado',
      demo: true,
      name: 'Festival de Vôlei de Praia',
      status: 'Encerrado',
      participant_count: 4,
      created_at: '2026-10-25T12:00:00.000Z',
      payload: {
        name: 'Festival de Vôlei de Praia',
        sportName: 'Vôlei',
        stage: 'done',
        stageLabel: 'Encerrado',
        format: 'elim',
        teams: [
          team('v1', 'Lara', 'Bia'), team('v2', 'Nina', 'Luiza'),
          team('v3', 'Duda', 'Carol'), team('v4', 'Mila', 'Júlia'),
        ],
        rounds: [
          [match('v1', 'v2', 21, 17), match('v3', 'v4', 18, 21)],
          [match('v1', 'v4', 21, 19)],
          [match('v2', 'v3', 21, 16)],
        ],
        placements: { v1: 1, v4: 2, v2: 3 },
      },
    },
    {
      id: 'demo-futevolei-grupos',
      demo: true,
      name: 'Liga de Futevôlei do Parque',
      status: 'Encerrado',
      participant_count: 4,
      created_at: '2026-10-20T12:00:00.000Z',
      payload: {
        name: 'Liga de Futevôlei do Parque',
        sportName: 'Futevôlei',
        stage: 'done',
        stageLabel: 'Encerrado',
        format: 'round',
        teams: [
          team('f1', 'Caio', 'Enzo'), team('f2', 'Rafa', 'Gui'),
          team('f3', 'Léo', 'Theo'), team('f4', 'Breno', 'Ivo'),
        ],
        groups: [{ name: 'Grupo A', teamIds: ['f1', 'f2', 'f3', 'f4'] }],
        groupMatches: [
          match('f1', 'f2', 18, 14, 'Grupo A'),
          match('f3', 'f4', 16, 18, 'Grupo A'),
          match('f1', 'f3', 18, 12, 'Grupo A'),
          match('f2', 'f4', 18, 16, 'Grupo A'),
          match('f1', 'f4', 18, 15, 'Grupo A'),
          match('f2', 'f3', 14, 18, 'Grupo A'),
        ],
        placements: { f1: 1, f2: 2, f3: 3 },
      },
    },
    {
      id: 'demo-beach-tennis',
      demo: true,
      name: 'Desafio Noturno de Beach Tennis',
      status: 'Encerrado',
      participant_count: 4,
      created_at: '2026-10-15T12:00:00.000Z',
      payload: {
        name: 'Desafio Noturno de Beach Tennis',
        sportName: 'Beach tennis',
        stage: 'done',
        stageLabel: 'Encerrado',
        format: 'elim',
        teams: [
          team('b1', 'Vivi', 'Isa'), team('b2', 'Mari', 'Ana'),
          team('b3', 'Tati', 'Cris'), team('b4', 'Lia', 'Gabi'),
        ],
        rounds: [
          [match('b1', 'b2', 6, 3), match('b3', 'b4', 4, 6)],
          [match('b1', 'b4', 6, 4)],
          [match('b2', 'b3', 6, 2)],
        ],
        placements: { b1: 1, b4: 2, b2: 3 },
      },
    },
    {
      id: 'demo-volei-andamento',
      demo: true,
      name: 'Copa de Vôlei para Iniciantes',
      status: 'Em andamento',
      participant_count: 4,
      created_at: '2026-11-01T12:00:00.000Z',
      payload: {
        name: 'Copa de Vôlei para Iniciantes',
        sportName: 'Vôlei',
        stage: 'groups',
        stageLabel: 'Fase de grupos',
        format: 'round',
        teams: [
          team('i1', 'Pedro', 'Davi'), team('i2', 'Noah', 'Leo'),
          team('i3', 'Beto', 'Alan'), team('i4', 'Igor', 'Rui'),
        ],
        groups: [{ name: 'Grupo A', teamIds: ['i1', 'i2', 'i3', 'i4'] }],
        groupMatches: [
          match('i1', 'i2', 21, 16, 'Grupo A'),
          match('i3', 'i4', 18, 21, 'Grupo A'),
          match('i1', 'i3', null, null, 'Grupo A'),
          match('i2', 'i4', null, null, 'Grupo A'),
        ],
      },
    },
  ];

  function node(tag, text, className) {
    var element = document.createElement(tag);
    if (text != null) element.textContent = String(text);
    if (className) element.className = className;
    return element;
  }

  function allMatches(tournament) {
    var matches = (tournament.groupMatches || []).slice();
    (tournament.rounds || []).forEach(function (round) {
      if (Array.isArray(round)) matches = matches.concat(round);
    });
    if (tournament.double) {
      ['wbRounds', 'lbRounds'].forEach(function (key) {
        (tournament.double[key] || []).forEach(function (round) {
          if (Array.isArray(round)) matches = matches.concat(round);
        });
      });
      if (tournament.double.gf) matches.push(tournament.double.gf);
      if (tournament.double.reset) matches.push(tournament.double.reset);
    }
    return matches;
  }

  function teamStatistics(tournament) {
    var stats = new Map();
    (tournament.teams || []).forEach(function (team) {
      stats.set(team.id, {
        team: team, played: 0, wins: 0, losses: 0, score: 0, against: 0, points: 0,
      });
    });
    allMatches(tournament).forEach(function (match) {
      if (!match || !match.winner || !match.a || !match.b) return;
      [[match.a, match.scoreA, match.scoreB], [match.b, match.scoreB, match.scoreA]]
        .forEach(function (line) {
          var row = stats.get(line[0]);
          if (!row) return;
          row.played += 1;
          row.score += Number(line[1]) || 0;
          row.against += Number(line[2]) || 0;
          if (match.winner === line[0]) {
            row.wins += 1;
            row.points += 10;
          } else {
            row.losses += 1;
          }
        });
    });

    var placements = tournament.placements || {};
    if (tournament.stage === 'done' && tournament.format === 'round' &&
      tournament.groups && tournament.groups[0]) {
      var group = tournament.groups[0];
      var rows = group.teamIds.map(function (id) {
        return { id: id, wins: 0, score: 0, against: 0, points: 0, team: stats.get(id).team };
      });
      (tournament.groupMatches || []).filter(function (match) {
        return match.group === group.name && match.winner;
      }).forEach(function (match) {
        var a = rows.find(function (row) { return row.id === match.a; });
        var b = rows.find(function (row) { return row.id === match.b; });
        if (!a || !b) return;
        a.score += Number(match.scoreA) || 0;
        a.against += Number(match.scoreB) || 0;
        b.score += Number(match.scoreB) || 0;
        b.against += Number(match.scoreA) || 0;
        if (match.winner === a.id) {
          a.wins += 1;
          a.points += 3;
        } else {
          b.wins += 1;
          b.points += 3;
        }
      });
      rows.sort(function (a, b) {
        return b.points - a.points ||
          ((b.score - b.against) - (a.score - a.against)) ||
          b.score - a.score ||
          String(a.team.name1).localeCompare(String(b.team.name1), 'pt-BR');
      });
      placements = {};
      rows.slice(0, 3).forEach(function (row, index) {
        placements[row.id] = index + 1;
      });
    }
    if (tournament.stage === 'done') {
      Object.keys(placements).forEach(function (id) {
        var row = stats.get(id);
        var place = Number(placements[id]);
        if (row && place >= 1 && place <= 3) {
          row.points += place === 1 ? 20 : place === 2 ? 10 : 5;
        }
      });
    }
    return Array.from(stats.values()).sort(function (a, b) {
      return b.points - a.points || b.wins - a.wins ||
        ((b.score - b.against) - (a.score - a.against)) ||
        String(a.team.name1).localeCompare(String(b.team.name1), 'pt-BR');
    });
  }

  function renderDetail(tournament, demo) {
    selectedTournamentId = tournament.id || null;
    selectedTournamentIsDemo = !!demo;
    selectedTournamentSnapshot = JSON.stringify(tournament);
    detailElement.replaceChildren();
    var panel = node('section', null, 'section detail-panel');
    var back = node('button', '← Voltar aos campeonatos', 'back-button');
    back.type = 'button';
    back.onclick = function () {
      selectedTournamentId = null;
      selectedTournamentSnapshot = '';
      detailElement.replaceChildren();
      listElement.hidden = false;
      if (toolbar) toolbar.hidden = false;
      listElement.scrollIntoView({ behavior: 'smooth', block: 'start' });
    };
    listElement.hidden = true;
    if (toolbar) toolbar.hidden = true;
    panel.appendChild(back);
    panel.appendChild(node('span', demo ? 'EXEMPLO DE CAMPEONATO' : 'CAMPEONATO PUBLICADO', 'section-kicker'));
    panel.appendChild(node('h2', tournament.name || 'Campeonato', 'detail-title'));
    if (demo) {
      panel.appendChild(node('p',
        'Demonstração: nomes, placares e estatísticas fictícios. As partidas reais serão exibidas aqui após serem concluídas e publicadas.',
        'demo-note'));
    }
    panel.appendChild(node('p',
      (tournament.sportName || 'Esporte não informado') + ' · ' +
      (tournament.stageLabel || tournament.stage || tournament.status || 'Status indisponível') +
      ' · ' + (tournament.teams || []).length + ' duplas',
      'detail-subtitle'));
    var matches = allMatches(tournament).filter(function (match) {
      return match && match.winner && match.a && match.b;
    });
    panel.appendChild(node('div', null, 'stats'));
    var stats = panel.lastElementChild;
    [
      ['Duplas', (tournament.teams || []).length],
      ['Jogos concluídos', matches.length],
      ['Pódios', Object.keys(tournament.placements || {}).length],
    ].forEach(function (item) {
      var card = node('div', null, 'stat');
      card.appendChild(node('b', item[1]));
      card.appendChild(node('span', item[0]));
      stats.appendChild(card);
    });

    var classification = node('div', null, 'scroll data-block');
    classification.appendChild(node('h3', 'Classificação'));
    var table = node('table');
    var head = node('thead');
    var header = node('tr');
    ['#', 'Dupla', 'J', 'V', 'D', 'Saldo', 'Pts'].forEach(function (label) {
      header.appendChild(node('th', label));
    });
    head.appendChild(header);
    table.appendChild(head);
    var body = node('tbody');
    teamStatistics(tournament).forEach(function (row, index) {
      var tr = node('tr');
      [
        index + 1,
        (row.team.name1 || '—') + ' / ' + (row.team.name2 || '—'),
        row.played, row.wins, row.losses, row.score - row.against, row.points,
      ].forEach(function (value) { tr.appendChild(node('td', value)); });
      body.appendChild(tr);
    });
    table.appendChild(body);
    classification.appendChild(table);
    panel.appendChild(classification);

    var results = node('div', null, 'scroll data-block');
    results.appendChild(node('h3', 'Resultados'));
    var resultTable = node('table');
    var resultHead = node('thead');
    var resultHeader = node('tr');
    ['Confronto', 'Placar'].forEach(function (label) {
      resultHeader.appendChild(node('th', label));
    });
    resultHead.appendChild(resultHeader);
    resultTable.appendChild(resultHead);
    var resultBody = node('tbody');
    matches.forEach(function (match) {
      var a = (tournament.teams || []).find(function (team) { return team.id === match.a; });
      var b = (tournament.teams || []).find(function (team) { return team.id === match.b; });
      var tr = node('tr');
      tr.appendChild(node('td',
        (a ? a.name1 + ' / ' + a.name2 : 'Dupla') + ' × ' +
        (b ? b.name1 + ' / ' + b.name2 : 'Dupla')));
      tr.appendChild(node('td', String(match.scoreA) + ' × ' + String(match.scoreB)));
      resultBody.appendChild(tr);
    });
    resultTable.appendChild(resultBody);
    results.appendChild(resultTable);
    if (!matches.length) results.appendChild(node('p', 'Ainda não há resultados concluídos.', 'muted'));
    panel.appendChild(results);
    detailElement.appendChild(panel);
  }

  function statusKey(row) {
    var payload = row.payload || {};
    var status = String(row.status || payload.stageLabel || payload.stage || '').toLowerCase();
    if (status === 'completed' || status === 'done' || status === 'encerrado') return 'completed';
    if (status === 'registration' || status.indexOf('inscri') >= 0) return 'registration';
    if (status === 'in_progress' || status === 'groups' || status.indexOf('andamento') >= 0 || status.indexOf('fase') >= 0) return 'in_progress';
    return 'all';
  }

  function matchesBrowseFilter(row) {
    var payload = row.payload || {};
    var searchText = [row.name, payload.sportName, payload.stageLabel].join(' ').toLocaleLowerCase('pt-BR');
    if (tournamentQuery && searchText.indexOf(tournamentQuery) < 0) return false;
    return tournamentFilter === 'all' || statusKey(row) === tournamentFilter;
  }

  function renderTournamentButton(row, isDemo) {
    var button = node('button', null, 'item');
    var description = node('span', null, 'item-copy');
    description.appendChild(node('strong', row.name || 'Campeonato sem nome', 'item-title'));
    var meta = node('span', null, 'item-meta');
    var key = statusKey(row);
    var label = key === 'completed' ? 'Encerrado'
      : key === 'registration' ? 'Inscri\u00e7\u00f5es abertas'
      : key === 'in_progress' ? 'Em andamento'
      : row.status || 'Status indispon\u00edvel';
    var badgeClass = key === 'completed' ? 'done' : key === 'registration' ? 'registration' : key === 'in_progress' ? 'live' : '';
    meta.appendChild(node('span', isDemo ? 'Exemplo fict\u00edcio' : label, 'badge ' + badgeClass));
    var teamCount = row.participant_count || row.payload && row.payload.teams && row.payload.teams.length || 0;
    meta.appendChild(node('span', String(teamCount) + ' duplas'));
    if (row.payload && row.payload.sportName) meta.appendChild(node('span', row.payload.sportName));
    description.appendChild(meta);
    button.appendChild(description);
    var cta = node('span', null, 'item-cta');
    cta.appendChild(node('span', isDemo ? 'Ver exemplo' : 'Ver campeonato'));
    cta.appendChild(node('span', '\u203a', 'item-arrow'));
    button.appendChild(cta);
    button.onclick = function () { renderDetail(row.payload, isDemo); };
    return button;
  }

  function renderList() {
    listElement.replaceChildren();
    var visibleTournaments = tournaments.filter(matchesBrowseFilter);
    var visibleDemos = demoTournaments.filter(matchesBrowseFilter);
    var liveSection = node('section', null, 'section');
    liveSection.id = 'published';
    var liveHead = node('div', null, 'section-head');
    var liveTitle = node('div');
    liveTitle.appendChild(node('span', 'PLACAR AO VIVO', 'section-kicker'));
    liveTitle.appendChild(node('h2', 'Campeonatos publicados'));
    liveTitle.appendChild(node('p', 'Resultados e classifica\u00e7\u00f5es compartilhados pelos organizadores.'));
    liveHead.appendChild(liveTitle);
    liveHead.appendChild(node('span', visibleTournaments.length + ' encontrados', 'section-count'));
    liveSection.appendChild(liveHead);
    var liveList = node('div', null, 'list');
    if (visibleTournaments.length) {
      visibleTournaments.forEach(function (row, index) {
        var card = renderTournamentButton(row, false);
        card.style.animationDelay = Math.min(index * 45, 360) + 'ms';
        liveList.appendChild(card);
      });
    } else {
      var emptyMessage = tournamentQuery || tournamentFilter !== 'all'
        ? 'Nenhum campeonato corresponde a essa busca ou filtro.'
        : requiresAccount
        ? 'Entre na sua conta para consultar campeonatos reais publicados.'
        : 'Ainda n\u00e3o h\u00e1 campeonatos publicados. Confira os exemplos enquanto isso.';
      var empty = node('div', emptyMessage, 'empty');
      if (requiresAccount && !tournamentQuery && tournamentFilter === 'all') {
        var accountLink = node('a', 'Entrar ou criar conta', 'account-link');
        accountLink.href = './PlacarUai.html?auth=required';
        empty.appendChild(document.createElement('br'));
        empty.appendChild(accountLink);
      }
      liveList.appendChild(empty);
    }
    liveSection.appendChild(liveList);
    listElement.appendChild(liveSection);

    var demoSection = node('section', null, 'section demo-section');
    var demoHead = node('div', null, 'section-head');
    var demoTitle = node('div');
    demoTitle.appendChild(node('span', 'APRENDA EXPLORANDO', 'section-kicker'));
    demoTitle.appendChild(node('h2', 'Conhe\u00e7a o formato'));
    demoTitle.appendChild(node('p', 'Abra um exemplo para ver classifica\u00e7\u00e3o e resultados.'));
    demoHead.appendChild(demoTitle);
    demoHead.appendChild(node('span', visibleDemos.length + ' exemplos', 'section-count'));
    demoSection.appendChild(demoHead);
    demoSection.appendChild(node('p', 'Os nomes, placares e estat\u00edsticas abaixo s\u00e3o fict\u00edcios e servem apenas para demonstrar a p\u00e1gina.', 'demo-disclaimer'));
    var examples = node('div', null, 'list');
    if (visibleDemos.length) {
      visibleDemos.forEach(function (row, index) {
        var card = renderTournamentButton(row, true);
        card.style.animationDelay = Math.min(index * 45, 360) + 'ms';
        examples.appendChild(card);
      });
    } else {
      examples.appendChild(node('div', 'Nenhum exemplo combina com essa busca ou filtro.', 'empty'));
    }
    demoSection.appendChild(examples);
    listElement.appendChild(demoSection);
  }

  async function refreshPublicTournaments() {
    if (!client || !currentTournamentUser) return;
    if (refreshInProgress) return;
    refreshInProgress = true;
    try {
      var result = await client.from('tournaments')
        .select('id, organizer_id, name, status, participant_count, created_at, payload')
        .eq('is_published', true)
        .order('created_at', { ascending: false })
        .limit(100);
      if (result.error) {
        console.error('Unable to load public tournaments', result.error.code);
        message.textContent = 'Não foi possível atualizar os campeonatos publicados. Tente novamente em instantes.';
        message.className = 'error';
        return;
      }
      var updatedTournaments = (result.data || []).map(function (row) {
        return Object.assign({}, row, { payload: row.payload || {} });
      });
      var tournamentsChanged = JSON.stringify(updatedTournaments) !== JSON.stringify(tournaments);
      tournaments = updatedTournaments;
      if (tournamentsChanged) renderList();
      if (selectedTournamentId) {
        var selected = selectedTournamentIsDemo
          ? demoTournaments.find(function (row) { return row.id === selectedTournamentId; })
          : tournaments.find(function (row) { return row.id === selectedTournamentId; });
        if (selected && JSON.stringify(selected.payload) !== selectedTournamentSnapshot) {
          renderDetail(selected.payload, selectedTournamentIsDemo);
        }
        else {
          if (!selected) {
            selectedTournamentId = null;
            selectedTournamentSnapshot = '';
            detailElement.replaceChildren();
          }
        }
      }
      message.textContent = demoTournaments.length + ' exemplos fictícios · ' +
        tournaments.length + ' campeonato(s) publicado(s). Atualizações automáticas ativadas.';
      message.className = 'muted';
    } finally {
      refreshInProgress = false;
    }
  }

  async function load() {
    renderList();
    message.textContent = demoTournaments.length +
      ' exemplos fictícios · carregando campeonatos publicados...';
    if (
      !config.url || !/^https:\/\/[a-z0-9-]+\.supabase\.co$/i.test(config.url) ||
      !config.publishableKey || !config.publishableKey.startsWith('sb_publishable_') ||
      !window.supabase
    ) {
      message.textContent = 'Os exemplos estão disponíveis. A consulta de campeonatos reais ainda não foi configurada.';
      message.className = 'muted';
      return;
    }
    client = window.supabase.createClient(config.url, config.publishableKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
        storage: window.placaruaiAuthStorage && window.placaruaiAuthStorage.storage,
      },
    });
    var sessionResult = await client.auth.getSession();
    if (sessionResult.error) {
      console.error('Unable to verify tournament access session', sessionResult.error.code);
      message.textContent = 'Os exemplos estão disponíveis, mas não foi possível verificar seu acesso.';
      message.className = 'muted';
      return;
    }
    if (!sessionResult.data.session) {
      requiresAccount = true;
      renderList();
      message.textContent = 'Explore os exemplos fictícios; entre na sua conta para consultar os campeonatos reais.';
      return;
    }
    currentTournamentUser = sessionResult.data.session.user;
    await refreshPublicTournaments();
    var params = new URLSearchParams(window.location.search);
    var id = params.get('id');
    var organizer = params.get('organizer');
    var requested = tournaments.find(function (row) {
      return row.id === id && (!organizer || row.organizer_id === organizer);
    });
    if (!requested && id && organizer) {
      var selected = await client.from('tournaments')
        .select('id, organizer_id, name, status, participant_count, created_at, payload')
        .eq('id', id)
        .eq('organizer_id', organizer)
        .eq('is_published', true)
        .maybeSingle();
      if (selected.error) {
        console.error('Unable to load public tournament details', selected.error.code);
        message.textContent = 'Não foi possível carregar o campeonato publicado. Tente novamente em instantes.';
        message.className = 'error';
        return;
      }
      if (selected.data) {
        requested = Object.assign({}, selected.data, {
          payload: selected.data.payload || {},
        });
        tournaments.unshift(requested);
        renderList();
      }
    }
    if (requested) renderDetail(requested.payload, false);

    client.channel('public-tournaments-live')
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'tournaments',
        filter: 'is_published=eq.true',
      }, function () {
        refreshPublicTournaments().catch(function (error) {
          console.error('Unable to refresh public tournaments after a live update', error);
        });
      })
      .subscribe(function (status) {
        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          console.warn('Public tournament live updates are unavailable; periodic refresh remains active.');
        }
      });
    window.setInterval(function () {
      if (document.visibilityState === 'visible') {
        refreshPublicTournaments().catch(function (error) {
          console.error('Periodic public tournament refresh failed', error);
          message.textContent = 'Não foi possível atualizar a lista. Verifique a conexão.';
          message.className = 'error';
        });
      }
    }, 20000);
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'visible') {
        refreshPublicTournaments().catch(function (error) {
          console.error('Unable to refresh public tournaments after returning to the page', error);
        });
      }
    });
  }

  load().catch(function (error) {
    console.error('Public tournament query failed', error);
    message.textContent = 'Os exemplos estão disponíveis, mas não foi possível carregar os campeonatos reais.';
    message.className = 'muted';
  });
})();
