(function () {
  'use strict';

  var config = window.PLACARUAI_SUPABASE_CONFIG || {};
  var message = document.getElementById('message');
  var listElement = document.getElementById('list');
  var detailElement = document.getElementById('detail');
  var client = null;
  var tournaments = [];

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

  function renderDetail(tournament) {
    detailElement.replaceChildren();
    var panel = node('section', null, 'panel');
    panel.appendChild(node('h2', tournament.name || 'Campeonato'));
    panel.appendChild(node('p',
      (tournament.sportName || 'Esporte não informado') + ' · ' +
      (tournament.stageLabel || tournament.stage || tournament.status || 'Status indisponível') +
      ' · ' + (tournament.teams || []).length + ' duplas',
      'muted'));
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

    var classification = node('div', null, 'scroll');
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

    var results = node('div', null, 'scroll');
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

  function renderList() {
    listElement.replaceChildren();
    if (!tournaments.length) {
      listElement.appendChild(node('p', 'Nenhum campeonato publicado.', 'muted'));
      return;
    }
    tournaments.forEach(function (row) {
      var button = node('button', null, 'item');
      var description = node('span');
      description.appendChild(node('strong', row.name));
      description.appendChild(node('small',
        row.status + ' · ' + row.participant_count + ' duplas · ' +
        new Date(row.created_at).toLocaleDateString('pt-BR')));
      button.appendChild(description);
      button.appendChild(node('span', 'Consultar'));
      button.onclick = function () { renderDetail(row.payload); };
      listElement.appendChild(button);
    });
  }

  async function load() {
    if (
      !config.url || !/^https:\/\/[a-z0-9-]+\.supabase\.co$/i.test(config.url) ||
      !config.publishableKey || !config.publishableKey.startsWith('sb_publishable_') ||
      !window.supabase
    ) {
      message.textContent = 'A consulta pública ainda não foi configurada.';
      message.className = 'error';
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
      message.textContent = 'Não foi possível verificar seu acesso. Recarregue a página ou entre novamente.';
      message.className = 'error';
      return;
    }
    if (!sessionResult.data.session) {
      message.textContent = 'Entre ou crie uma conta para continuar e consultar os campeonatos publicados.';
      message.className = 'muted';
      listElement.replaceChildren(
        node('p', 'Apenas o placar pode ser usado sem uma conta. Seu acesso aos demais recursos exige autenticação.', 'muted')
      );
      var accountLink = node('a', 'Ir ao PlacarUai para entrar ou criar conta', 'account-link');
      accountLink.href = './PlacarUai.html?auth=required';
      listElement.appendChild(accountLink);
      return;
    }
    var result = await client.from('tournaments')
      .select('id, organizer_id, name, status, participant_count, created_at, payload')
      .eq('is_published', true)
      .order('created_at', { ascending: false })
      .limit(100);
    if (result.error) {
      console.error('Unable to load public tournaments', result.error.code);
      message.textContent = 'Não foi possível carregar os campeonatos públicos.';
      message.className = 'error';
      return;
    }
    tournaments = (result.data || []).map(function (row) {
      return Object.assign({}, row, { payload: row.payload || {} });
    });
    renderList();
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
        message.textContent = 'Não foi possível carregar o campeonato publicado.';
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
    if (requested) renderDetail(requested.payload);
    message.textContent = tournaments.length + ' campeonato(s) publicado(s).';
  }

  load().catch(function (error) {
    console.error('Public tournament query failed', error);
    message.textContent = 'Não foi possível carregar os campeonatos públicos.';
    message.className = 'error';
  });
})();
