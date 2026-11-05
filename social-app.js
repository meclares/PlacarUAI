(function () {
  'use strict';

  var api = window.placaruaiSocialApi;
  var debounceTimer = null;
  var activeSocialPanel = 'feed';

  function esc(value) {
    return window.esc(String(value == null ? '' : value));
  }

  function followButton(publicId, following) {
    return '<button type="button" class="social-follow-button" data-follow-id="' +
      esc(publicId) + '" data-following="' + String(following) + '" aria-pressed="' +
      String(following) + '">' + (following ? 'Seguindo' : 'Seguir') + '</button>';
  }

  function rows(value) {
    return Array.isArray(value) ? value : value ? [value] : [];
  }

  function avatar(photo, name) {
    return '<span class="social-avatar">' +
      (photo ? '<img src="' + esc(photo) + '" alt="" loading="lazy" referrerpolicy="no-referrer">' : esc(String(name || 'A').slice(0, 1).toUpperCase())) +
      '</span>';
  }

  function stateBadge(code) {
    if (!code || typeof window.stateFlagMarkup !== 'function') return '';
    return '<div class="social-state-badge">' + window.stateFlagMarkup(code) + '</div>';
  }

  function connectionDetails(person) {
    var sports = Array.isArray(person.sports) && person.sports.length
      ? person.sports.join(', ')
      : 'Modalidade não informada';
    return '<div class="social-connection-meta">' + stateBadge(person.state_code) +
      '<span>' + esc(sports) + '</span><b>Aproveitamento ' +
      esc(Number(person.win_percentage) || 0) + '%</b></div>';
  }

  function reportError(container, message) {
    var error = container.querySelector('.social-error');
    if (!error) {
      error = document.createElement('p');
      error.className = 'social-error';
      container.prepend(error);
    }
    error.textContent = message;
  }

  function matchDescription(activity) {
    activity = activity && typeof activity === 'object' ? activity : {};
    var a = activity.A || {};
    var b = activity.B || {};
    var sportNames = { volei: 'Vôlei', futevolei: 'Futevôlei', beach: 'Beach tennis' };
    var score = activity.scoreText ||
      (Number(a.pts || a.sets || 0) + ' × ' + Number(b.pts || b.sets || 0));
    return {
      teams: String(a.name || 'Dupla A') + ' × ' + String(b.name || 'Dupla B'),
      score: score,
      sport: sportNames[activity.mod] || 'Partida',
      venue: String(activity.venue || ''),
    };
  }

  function setupMatchInvitePicker(dialog) {
    var input = dialog.querySelector('#matchInviteSearch');
    var results = dialog.querySelector('#matchInviteResults');
    var selectedElement = dialog.querySelector('#matchInviteSelected');
    if (!input || !results || !selectedElement) return;

    var selected = [];
    dialog.__matchInvitees = selected;

    function drawSelected() {
      selectedElement.innerHTML = selected.map(function (person) {
        return '<span class="match-invite-chip">' + esc(person.display_name) +
          ' · ' + esc(person.public_id) +
          '<button type="button" data-remove-invite="' + esc(person.public_id) +
          '" aria-label="Remover ' + esc(person.display_name) + '">×</button></span>';
      }).join('');
      selectedElement.querySelectorAll('[data-remove-invite]').forEach(function (button) {
        button.onclick = function () {
          selected = selected.filter(function (person) {
            return person.public_id !== button.dataset.removeInvite;
          });
          dialog.__matchInvitees = selected;
          drawSelected();
        };
      });
    }

    input.oninput = function () {
      window.clearTimeout(debounceTimer);
      var query = input.value.trim();
      if (!query) {
        results.innerHTML = '';
        return;
      }
      debounceTimer = window.setTimeout(function () {
        api.searchProfiles(query).then(function (data) {
          var people = rows(data).filter(function (person) {
            return person.public_id !== api.publicId() &&
              !selected.some(function (item) { return item.public_id === person.public_id; });
          });
          results.innerHTML = people.length
            ? people.map(function (person) {
              return '<button type="button" data-add-invite="' + esc(person.public_id) + '">' +
                '<span>' + esc(person.display_name) + '</span><small>' +
                esc(person.public_id) + (person.city ? ' · ' + esc(person.city) : '') +
                '</small></button>';
            }).join('')
            : '<p class="social-muted">Nenhum atleta encontrado.</p>';
          results.querySelectorAll('[data-add-invite]').forEach(function (button) {
            button.onclick = function () {
              if (selected.length >= 3) {
                results.innerHTML = '<p class="social-muted">É possível convidar até três atletas.</p>';
                return;
              }
              var person = people.find(function (item) {
                return item.public_id === button.dataset.addInvite;
              });
              if (person) selected.push(person);
              dialog.__matchInvitees = selected;
              input.value = '';
              results.innerHTML = '';
              drawSelected();
            };
          });
        }).catch(function (error) {
          console.error('Unable to search athletes for a match', error);
          results.textContent = 'Não foi possível buscar atletas. Verifique a conexão e tente novamente.';
        });
      }, 250);
    };
  }

  function selectedMatchInvitees(dialog) {
    return dialog && Array.isArray(dialog.__matchInvitees)
      ? dialog.__matchInvitees.map(function (person) { return person.public_id; })
      : [];
  }

  function renderSocialProfile() {
    var searchSequence = 0;
    var host = document.getElementById('profile');
    if (!host) return;
    var oldRoot = host.querySelector('#socialRoot');
    if (oldRoot) oldRoot.remove();
    if (!api || !api.ready()) return;

    var root = document.createElement('section');
    root.id = 'socialRoot';
    root.className = 'social-root';
    var athleteIdCard = host.querySelector('.profile-public-id');
    if (athleteIdCard) athleteIdCard.insertAdjacentElement('afterend', root);
    else host.appendChild(root);

    var ownPublicId = api.publicId();
    var profileCache = Object.create(null);
    if (!ownPublicId) {
      root.innerHTML = '<p class="social-muted">Seu perfil ainda está sendo carregado. Atualize a página em instantes.</p>';
      return;
    }

    root.innerHTML =
      '<div class="social-heading"><div><h2>Seguindo e seguidores</h2>' +
      '<p>Encontre atletas pelo nome ou ID UA, siga perfis e acompanhe as atividades deles.</p></div></div>' +
      '<div id="socialError"></div>' +
      '<div class="social-counts" aria-label="Resumo social">' +
      '<div class="social-count"><b id="socialGames">—</b><span>Jogos</span></div>' +
      '<button class="social-count" data-relation="following"><b id="socialFollowing">—</b><span>Seguindo</span></button>' +
      '<button class="social-count" data-relation="followers"><b id="socialFollowers">—</b><span>Seguidores</span></button></div>' +
      '<div class="social-nav" role="group" aria-label="Recursos sociais">' +
      '<button type="button" data-panel="feed" aria-pressed="' + String(activeSocialPanel === 'feed') + '">Atividades de quem você segue</button>' +
      '<button type="button" data-panel="notifications" aria-pressed="' + String(activeSocialPanel === 'notifications') + '">Notificações <span id="socialNotificationCount"></span></button>' +
      '</div>' +
      '<section class="social-discovery" aria-labelledby="socialSearchTitle"><div class="social-discovery-head"><div><h3 id="socialSearchTitle">Encontrar atletas</h3>' +
      '<p>Digite o nome ou o ID UA completo ou parcial.</p></div></div>' +
      '<form class="social-search" id="socialSearch"><label class="social-search-label" for="socialQuery">Nome ou ID do atleta</label><div class="social-search-controls"><input id="socialQuery" type="search" maxlength="80" autocomplete="off" enterkeyhint="search" placeholder="Ex.: Ana Silva ou UA-AB12CD34" aria-label="Buscar atleta por nome ou ID UA">' +
      '<button type="submit" class="go">Buscar</button><button type="button" data-action="clear-search" aria-label="Limpar busca">Limpar</button></div></form>' +
      '<div id="socialSearchResults" class="social-list" aria-live="polite"><p class="social-search-hint">Os resultados e a opção de seguir aparecerão aqui.</p></div></section>' +
      '<div id="socialDetails" class="social-panel" hidden></div>' +
      '<div id="socialConnections" class="social-list" hidden></div>' +
      '<dialog id="socialPopup" class="social-popup" aria-label="Seguindo e seguidores"></dialog>' +
      '<section id="socialFeed" class="social-panel"' + (activeSocialPanel === 'feed' ? '' : ' hidden') + '><h3>Atividades de quem você segue</h3><div class="social-list" id="socialFeedList"><p class="social-muted">Carregando partidas...</p></div></section>' +
      '<section id="socialNotifications" class="social-panel"' + (activeSocialPanel === 'notifications' ? '' : ' hidden') + '><div class="social-heading"><div><h3>Notificações</h3></div><button type="button" data-action="mark-read">Marcar como lidas</button></div><div class="social-list" id="socialNotificationList"></div></section>';

    function showPopup(title, content) {
      var dialog = root.querySelector('#socialPopup');
      dialog.innerHTML = '<div class="social-popup-head"><h3>' + esc(title) +
        '</h3><button type="button" class="social-popup-close" data-action="close-popup" aria-label="Fechar">×</button></div>' +
        '<div class="social-popup-body">' + content + '</div>';
      dialog.onclick = function (event) { if (event.target === dialog) dialog.close(); };
      if (!dialog.open) dialog.showModal();
      return dialog;
    }

    function writeCount(selector, value) {
      var node = document.querySelector(selector);
      if (node) node.textContent = String(Math.max(0, Number(value) || 0));
    }

    function refreshMyCounts() {
      api.getProfile(ownPublicId).then(function (data) {
        var profile = rows(data)[0];
        if (!profile) return;
        writeCount('#socialFollowing', profile.following_count);
        writeCount('#socialFollowers', profile.followers_count);
        writeCount('#profileSocialFollowing', profile.following_count);
        writeCount('#profileSocialFollowers', profile.followers_count);
      }).catch(function (error) {
        console.error('Unable to refresh social connection counts', error);
      });
    }

    function setFollowButtons(publicId, following) {
      root.querySelectorAll('[data-follow-id]').forEach(function (button) {
        if (button.dataset.followId !== publicId) return;
        button.dataset.following = String(following);
        button.setAttribute('aria-pressed', String(following));
        button.textContent = following ? 'Seguindo' : 'Seguir';
        button.disabled = false;
      });
    }

    function cacheProfiles(people) {
      rows(people).forEach(function (person) {
        if (person && person.public_id) profileCache[person.public_id] = person;
      });
    }

    function openFollowConfirmation(profile, isFollowing, sourceButton) {
      showPopup(isFollowing ? 'Deixar de seguir?' : 'Confirmar para seguir',
        '<article class="social-confirm-card">' + avatar(profile.photo_url, profile.display_name) +
        '<div class="social-confirm-info"><b>' + esc(profile.display_name) + '</b><small>ID ' +
        esc(profile.public_id) + '</small></div></article><p data-follow-error class="social-error" role="status"></p>' +
        '<div class="social-popup-actions"><button type="button" data-action="close-popup">Cancelar</button>' +
        '<button type="button" class="go" data-follow-confirm="' + esc(profile.public_id) +
        '" data-following="' + String(isFollowing) + '">' + (isFollowing ? 'Deixar de seguir' : 'Seguir') + '</button></div>');
      if (sourceButton) sourceButton.disabled = false;
    }

    function confirmFollow(publicId, following, button) {
      var dialog = root.querySelector('#socialPopup');
      button.disabled = true;
      api.follow(publicId, following).then(function () {
        var delta = following ? 1 : -1;
        var followingCount = root.querySelector('#socialFollowing');
        if (followingCount && /^\d+$/.test(followingCount.textContent.trim())) {
          var current = Number(followingCount.textContent);
          writeCount('#socialFollowing', current + delta);
          writeCount('#profileSocialFollowing', current + delta);
        }
        root.querySelectorAll('[data-connection-relation="following"]').forEach(function (count) {
          if (count.dataset.profileId !== publicId) return;
          var total = Number(count.querySelector('b').textContent) || 0;
          count.querySelector('b').textContent = String(Math.max(0, total + delta));
        });
        setFollowButtons(publicId, following);
        refreshMyCounts();
        api.getProfile(publicId).then(function (data) {
          var target = rows(data)[0];
          if (!target) return;
          root.querySelectorAll('[data-connection-relation="followers"]').forEach(function (count) {
            if (count.dataset.profileId === publicId) count.querySelector('b').textContent = String(target.followers_count);
          });
        }).catch(function (error) { console.error('Unable to refresh followed athlete counts', error); });
        showPopup(following ? 'Agora você está seguindo' : 'Você deixou de seguir',
          '<p class="social-muted">' + (following ? 'O atleta foi adicionado à sua lista de Seguindo.' : 'O atleta foi removido da sua lista de Seguindo.') + '</p>' + (following ? '<div class="social-popup-actions"><button type="button" class="go" data-profile-id="' + esc(publicId) + '">Abrir perfil e comentar</button></div>' : ''));
      }).catch(function (error) {
        console.error('Unable to update athlete follow', error);
        button.disabled = false;
        var message = dialog.querySelector('[data-follow-error]');
        if (message) message.textContent = 'Não foi possível atualizar agora. Tente novamente.';
        else reportError(root, 'Não foi possível atualizar o acompanhamento. Tente novamente.');
      });
    }

    root.addEventListener('click', function (event) {
      var button = event.target.closest('button');
      if (!button) return;
      if (button.dataset.panel) {
        activeSocialPanel = button.dataset.panel;
        root.querySelectorAll('[data-panel]').forEach(function (tab) {
          tab.setAttribute('aria-pressed', tab === button ? 'true' : 'false');
        });
        root.querySelector('#socialFeed').hidden = button.dataset.panel !== 'feed';
        root.querySelector('#socialNotifications').hidden = button.dataset.panel !== 'notifications';
        return;
      }
      if (button.dataset.relation) {
        loadConnections(ownPublicId, button.dataset.relation);
        return;
      }
      if (button.dataset.action === 'close-popup') {
        root.querySelector('#socialPopup').close();
        return;
      }
      if (button.dataset.action === 'clear-search') {
        searchSequence++;
        root.querySelector('#socialQuery').value = '';
        var clearedResults = root.querySelector('#socialSearchResults');
        clearedResults.removeAttribute('aria-busy');
        clearedResults.innerHTML = '<p class="social-search-hint">Os resultados e a opção de seguir aparecerão aqui.</p>';
        var clearSubmit = root.querySelector('#socialSearch button[type="submit"]');
        clearSubmit.disabled = false;
        clearSubmit.textContent = 'Buscar';
        root.querySelector('#socialQuery').focus();
        return;
      }
      if (button.dataset.followConfirm) {
        confirmFollow(button.dataset.followConfirm, button.dataset.following !== 'true', button);
        return;
      }
      if (button.dataset.action === 'mark-read') {
        api.markNotificationsRead().then(renderSocialProfile).catch(function (error) {
          console.error('Unable to mark social notifications as read', error);
          reportError(root, 'Não foi possível atualizar as notificações.');
        });
        return;
      }
      if (button.dataset.action === 'back-profile') {
        root.querySelector('#socialPopup').close();
        return;
      }
      if (button.dataset.connectionRelation) {
        loadConnections(button.dataset.profileId, button.dataset.connectionRelation);
        return;
      }
      if (button.dataset.profileId) {
        showProfile(button.dataset.profileId);
        return;
      }
      if (button.dataset.followId) {
        var publicId = button.dataset.followId;
        var isFollowing = button.dataset.following === 'true';
        var cachedProfile = profileCache[publicId];
        if (cachedProfile) {
          openFollowConfirmation(cachedProfile, isFollowing, button);
          return;
        }
        button.disabled = true;
        api.getProfile(publicId).then(function (data) {
          var profile = rows(data)[0];
          if (!profile) throw new Error('Athlete profile is unavailable');
          cacheProfiles(profile);
          openFollowConfirmation(profile, isFollowing, button);
        }).catch(function (error) {
          console.error('Unable to load athlete before confirming follow', error);
          button.disabled = false;
          reportError(root, 'Não foi possível carregar o perfil do atleta. Tente novamente.');
        });
        return;
      }
      if (button.dataset.matchId && button.dataset.decision) {
        button.disabled = true;
        api.respondToMatch(button.dataset.matchId, button.dataset.decision)
          .then(renderSocialProfile)
          .catch(function (error) {
            console.error('Unable to respond to match invitation', error);
            button.disabled = false;
            reportError(root, 'Não foi possível responder ao convite. Atualize a página e tente novamente.');
          });
      }
    });

    root.querySelector('#socialSearch').onsubmit = function (event) {
      event.preventDefault();
      var query = root.querySelector('#socialQuery').value.trim();
      if (!query) {
        root.querySelector('#socialQuery').focus();
        return;
      }
      var requestId = ++searchSequence;
      var resultBox = root.querySelector('#socialSearchResults');
      var submitButton = root.querySelector('#socialSearch button[type="submit"]');
      resultBox.setAttribute('aria-busy', 'true');
      resultBox.innerHTML = '<p class="social-muted">Buscando atletas...</p>';
      submitButton.disabled = true;
      submitButton.textContent = 'Buscando…';
      api.searchProfiles(query).then(function (data) {
        if (requestId !== searchSequence) return;
        var people = rows(data).filter(function (person) {
          return person.public_id !== ownPublicId;
        });
        cacheProfiles(people);
        resultBox.innerHTML = people.length
          ? '<p class="social-search-result-count">' + people.length + (people.length === 1 ? ' atleta encontrado' : ' atletas encontrados') + '</p>' +
            people.map(function (person) {
            return '<article class="social-person">' + avatar(person.photo_url, person.display_name) +
              '<div class="social-person-info"><b>' + esc(person.display_name) + '</b><small>' +
              esc(person.public_id) + (person.city ? ' · ' + esc(person.city) : '') +
              (person.sports && person.sports.length ? ' · ' + esc(person.sports.join(', ')) : '') +
              '</small></div><div class="social-person-actions">' +
              '<button type="button" data-profile-id="' + esc(person.public_id) + '">Ver perfil</button>' +
              followButton(person.public_id, person.followed_by_me === true) + '</div></article>';
          }).join('')
          : '<p class="social-muted">Nenhum atleta encontrado. Confira o nome ou o ID.</p>';
      }).catch(function (error) {
        if (requestId !== searchSequence) return;
        console.error('Unable to search athlete profiles', error);
        resultBox.innerHTML = '<p class="social-error">Não foi possível buscar atletas. Verifique a conexão e tente novamente.</p>';
      }).finally(function () {
        if (requestId !== searchSequence) return;
        resultBox.removeAttribute('aria-busy');
        submitButton.disabled = false;
        submitButton.textContent = 'Buscar';
      });
    };
    root.querySelector('#socialQuery').addEventListener('input', function () {
      searchSequence++;
      var currentSubmit = root.querySelector('#socialSearch button[type="submit"]');
      currentSubmit.disabled = false;
      currentSubmit.textContent = 'Buscar';
      var currentResults = root.querySelector('#socialSearchResults');
      currentResults.removeAttribute('aria-busy');
      currentResults.innerHTML = '<p class="social-search-hint">Pressione Buscar para pesquisar este termo.</p>';
    });

    api.getProfile(ownPublicId).then(function (data) {
      var profile = rows(data)[0];
      if (!profile) {
        reportError(root, 'Seu perfil social não foi encontrado. Confirme se a migração do Supabase foi aplicada.');
        return;
      }
      root.querySelector('#socialFollowing').textContent = profile.following_count;
      root.querySelector('#socialFollowers').textContent = profile.followers_count;
      root.querySelector('#socialGames').textContent = profile.games_count;
      var profileGames = document.getElementById('profileSocialGames');
      var profileFollowing = document.getElementById('profileSocialFollowing');
      var profileFollowers = document.getElementById('profileSocialFollowers');
      if (profileGames) profileGames.textContent = profile.games_count;
      if (profileFollowing) profileFollowing.textContent = profile.following_count;
      if (profileFollowers) profileFollowers.textContent = profile.followers_count;
    }).catch(function (error) {
      console.error('Unable to load athlete social profile', error);
      reportError(root, 'Não foi possível carregar o perfil social. Verifique se a migração do Supabase foi aplicada.');
    });

    api.followedActivities().then(function (data) {
      var activities = rows(data);
      var feed = root.querySelector('#socialFeedList');
      feed.innerHTML = activities.length
        ? activities.map(function (item) {
          var activity = item.activity || {};
          var tournament = activity.kind === 'tournament';
          var description = matchDescription(activity);
          var activityDetails = tournament
            ? esc(activity.sport || 'Campeonato') + ' · ' +
              Number(activity.participant_count || 0) + ' duplas'
            : esc(description.sport) + ' · ' +
              (item.played_at ? new Date(item.played_at).toLocaleString('pt-BR') : '');
          return '<article class="social-activity">' + avatar(item.photo_url, item.athlete_name) +
            '<div class="social-person-info"><b>' + esc(item.athlete_name) +
            (tournament ? ' concluiu um campeonato' : ' concluiu uma partida') + '</b>' +
            '<small>' + esc(item.city || 'Cidade não informada') + ' · ' + activityDetails + '</small>' +
            (tournament
              ? '<div class="social-game-score">🏆 ' + esc(activity.tournament_name || 'Campeonato') + '</div>'
              : '<div class="social-game-score">' + esc(description.teams) + '</div><b>' +
                esc(description.score) + '</b>' +
                (activity.partner ? '<small>Parceiro: ' + esc(activity.partner) + '</small>' : '') +
                (description.venue ? '<small>Local: ' + esc(description.venue) + '</small>' : '')) +
            '</div><div class="social-actions"><button type="button" data-profile-id="' +
            esc(item.athlete_public_id) + '">Ver perfil</button></div></article>';
        }).join('')
        : '<p class="social-muted">Ainda não há atividades de atletas que você segue.</p>';
    }).catch(function (error) {
      console.error('Unable to load followed athletes activities', error);
      root.querySelector('#socialFeedList').innerHTML =
        '<p class="social-error">Não foi possível carregar as atividades de quem você segue.</p>';
    });

    api.notifications().then(function (data) {
      var notifications = rows(data);
      var unread = notifications.filter(function (item) { return !item.read_at; }).length;
      root.querySelector('#socialNotificationCount').textContent = unread ? '(' + unread + ')' : '';
      var list = root.querySelector('#socialNotificationList');
      list.innerHTML = notifications.length
        ? notifications.map(function (item) {
          var message = item.notification_type === 'follow'
            ? item.actor_name + ' começou a seguir você.'
            : item.notification_type === 'match_invitation'
            ? item.actor_name + ' convidou você para confirmar uma partida.'
            : item.actor_name + ' concluiu uma partida.';
          return '<article class="social-notification' + (item.read_at ? '' : ' unread') + '">' +
            avatar('', item.actor_name) + '<div class="social-person-info"><b>' + esc(message) +
            '</b><small>' + esc(new Date(item.created_at).toLocaleString('pt-BR')) + '</small>' +
            (item.notification_type === 'match_invitation' && item.match_id
              ? item.invitation_status === 'pending'
                ? '<div class="social-actions"><button type="button" data-match-id="' +
                  esc(item.match_id) + '" data-decision="accepted" class="go">Aceitar partida</button>' +
                  '<button type="button" data-match-id="' + esc(item.match_id) +
                  '" data-decision="rejected">Recusar</button></div>'
                : '<small>Convite ' + (item.invitation_status === 'accepted'
                  ? 'aceito'
                  : item.invitation_status === 'rejected' ? 'recusado' : 'indisponível') + '.</small>'
              : '') + '</div></article>';
        }).join('')
        : '<p class="social-muted">Você ainda não tem notificações.</p>';
    }).catch(function (error) {
      console.error('Unable to load social notifications', error);
      root.querySelector('#socialNotificationList').innerHTML =
        '<p class="social-error">Não foi possível carregar suas notificações.</p>';
    });

    function loadConnections(publicId, relation) {
      var title = relation === 'following' ? 'Seguindo' : 'Seguidores';
      showPopup(title, '<p class="social-muted">Carregando atletas...</p>');
      api.getProfile(publicId).then(function (data) {
        var target = rows(data)[0];
        if (!target) throw new Error('Profile is unavailable');
        if (relation === 'followers' && target.followers_hidden && !target.is_self) {
          showPopup(title, '<p class="social-muted">Este atleta ocultou a lista. Total de seguidores: <b>' +
            esc(target.followers_count) + '</b>.</p>');
          return null;
        }
        return api.listConnections(publicId, relation);
      }).then(function (data) {
        if (data === null) return;
        var people = rows(data);
        cacheProfiles(people);
        showPopup(title, '<div class="social-list">' + (people.length
            ? people.map(function (person) {
              return '<article class="social-person">' + avatar(person.photo_url, person.display_name) +
                '<div class="social-person-info"><b>' + esc(person.display_name) + '</b><small>' +
                esc(person.public_id) + (person.city ? ' · ' + esc(person.city) : '') +
                '</small>' + connectionDetails(person) + '</div><div class="social-person-actions"><button type="button" data-profile-id="' +
                esc(person.public_id) + '">Ver perfil</button>' +
                (person.public_id !== ownPublicId
                  ? followButton(person.public_id, person.followed_by_me === true)
                  : '') + '</div></article>';
            }).join('')
            : '<p class="social-muted">Ainda não há atletas nesta lista.</p>') + '</div>');
      }).catch(function (error) {
        console.error('Unable to load athlete connections', error);
        var missingSocialRpc = error && ['PGRST202', '42883'].indexOf(String(error.code || '')) >= 0;
        var message = missingSocialRpc && relation === 'followers'
          ? 'A lista de seguidores ainda n&atilde;o est&aacute; dispon&iacute;vel no servidor. Atualize as migra&ccedil;&otilde;es do Supabase para habilitar esta fun&ccedil;&atilde;o com prote&ccedil;&atilde;o de privacidade.'
          : 'N&atilde;o foi poss&iacute;vel carregar esta lista. Tente novamente.';
        showPopup(title, '<p class="social-error">' + message + '</p>');
      });
    }

    function showProfile(publicId) {
      showPopup('Perfil do atleta', '<p class="social-muted">Carregando perfil...</p>');
      api.getProfile(publicId).then(function (data) {
        var profile = rows(data)[0];
        if (!profile) {
          showPopup('Perfil do atleta', '<p class="social-muted">Este perfil não está disponível.</p>');
          return;
        }
        cacheProfiles(profile);
        showPopup(profile.display_name, '<article class="social-profile-card"><div class="social-profile-top">' +
          avatar(profile.photo_url, profile.display_name) + '<div class="social-profile-identity">' + stateBadge(profile.state_code) + '<div><h3>' +
          esc(profile.display_name) + '</h3><p>' + esc(profile.public_id) + ' · ' +
          esc(profile.city || 'Cidade não informada') + '</p><p>' +
          esc((profile.sports || []).join(', ') || 'Modalidade não informada') + '</p><p>Aproveitamento: ' + (profile.win_percentage == null ? '—' : esc(profile.win_percentage) + '%') + '</p></div></div></div>' +
          '<div class="social-counts"><div class="social-count"><b>' +
          esc(profile.games_count) + '</b><span>Jogos</span></div><button class="social-count" data-connection-relation="following" data-profile-id="' +
          esc(profile.public_id) + '"><b>' + esc(profile.following_count) +
          '</b><span>Seguindo</span></button><button class="social-count" data-connection-relation="followers" data-profile-id="' +
          esc(profile.public_id) + '"><b>' + esc(profile.followers_count) +
          '</b><span>Seguidores</span></button></div>' +
          '<div class="social-actions"><button type="button" data-action="back-profile">Voltar</button>' +
          (!profile.is_self ? followButton(profile.public_id, profile.is_following === true) : '') +
          '</div></article><div data-athlete-review-mount></div>');
        var reviewMount = root.querySelector('[data-athlete-review-mount]');
        if (reviewMount && typeof window.mountAthleteReviews === 'function') {
          window.mountAthleteReviews(reviewMount, profile.public_id);
        }
      }).catch(function (error) {
        console.error('Unable to load public athlete profile', error);
        var cached = profileCache[publicId];
        if (!cached) {
          showPopup('Perfil do atleta', '<p class="social-error">Não foi possível abrir este perfil. Verifique a conexão e tente novamente.</p>');
          return;
        }
        showPopup(cached.display_name, '<article class="social-profile-card"><div class="social-profile-top">' +
          avatar(cached.photo_url, cached.display_name) + '<div><h3>' + esc(cached.display_name) +
          '</h3><p>' + esc(cached.public_id) + ' · ' + esc(cached.city || 'Cidade não informada') +
          '</p><p>' + esc((cached.sports || []).join(', ') || 'Modalidade não informada') + '</p></div></div>' +
          '<p class="social-muted">Os dados completos do perfil não carregaram agora. Você ainda pode seguir este atleta.</p>' +
          '<div class="social-actions"><button type="button" data-action="back-profile">Voltar</button>' +
          followButton(cached.public_id, cached.followed_by_me === true) + '</div></article>');
      });
    }

    host.querySelectorAll('[data-social-connection]').forEach(function (button) {
      button.onclick = function () {
      var relationButton = root.querySelector('[data-relation="' + button.dataset.socialConnection + '"]');
        if (relationButton) {
          root.scrollIntoView({ behavior: 'smooth', block: 'start' });
          relationButton.click();
        }
      };
    });
  }

  window.renderSocialProfile = renderSocialProfile;
  window.setupMatchInvitePicker = setupMatchInvitePicker;
  window.selectedMatchInvitees = selectedMatchInvitees;
  renderSocialProfile();
})();
