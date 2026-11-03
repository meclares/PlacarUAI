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
      String(following) + '">' + (following ? 'Na arquibancada' : 'Arquibancada') + '</button>';
  }

  function rows(value) {
    return Array.isArray(value) ? value : value ? [value] : [];
  }

  function avatar(photo, name) {
    return '<span class="social-avatar">' +
      (photo ? '<img src="' + esc(photo) + '" alt="" loading="lazy" referrerpolicy="no-referrer">' : esc(String(name || 'A').slice(0, 1).toUpperCase())) +
      '</span>';
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
    var host = document.getElementById('profile');
    if (!host) return;
    var oldRoot = host.querySelector('#socialRoot');
    if (oldRoot) oldRoot.remove();
    if (!api || !api.ready()) return;

    var root = document.createElement('section');
    root.id = 'socialRoot';
    root.className = 'social-root';
    host.appendChild(root);

    var ownPublicId = api.publicId();
    if (!ownPublicId) {
      root.innerHTML = '<p class="social-muted">Seu perfil ainda está sendo carregado. Atualize a página em instantes.</p>';
      return;
    }

    root.innerHTML =
      '<div class="social-heading"><div><h2>Craques e Arquibancada</h2>' +
      '<p>Encontre atletas, acompanhe partidas e veja quem acompanha você.</p></div></div>' +
      '<div id="socialError"></div>' +
      '<div class="social-counts" aria-label="Resumo social">' +
      '<div class="social-count"><b id="socialGames">—</b><span>Jogos</span></div>' +
      '<button class="social-count" data-relation="craques"><b id="socialCraques">—</b><span>Craques</span></button>' +
      '<button class="social-count" data-relation="arquibancada"><b id="socialAudience">—</b><span>Arquibancada</span></button></div>' +
      '<div class="social-nav" role="group" aria-label="Recursos sociais">' +
      '<button type="button" data-panel="feed" aria-pressed="' + String(activeSocialPanel === 'feed') + '">Jogos da arquibancada</button>' +
      '<button type="button" data-panel="notifications" aria-pressed="' + String(activeSocialPanel === 'notifications') + '">Notificações <span id="socialNotificationCount"></span></button>' +
      '</div>' +
      '<form class="social-search" id="socialSearch"><input id="socialQuery" type="search" maxlength="80" placeholder="Buscar por nome ou ID do atleta" aria-label="Buscar atleta por nome ou ID">' +
      '<button type="submit" class="go">Buscar atletas</button></form><div id="socialSearchResults" class="social-list"></div>' +
      '<div id="socialDetails" class="social-panel" hidden></div>' +
      '<div id="socialConnections" class="social-list" hidden></div>' +
      '<section id="socialFeed" class="social-panel"' + (activeSocialPanel === 'feed' ? '' : ' hidden') + '><h3>Jogos da arquibancada</h3><div class="social-list" id="socialFeedList"><p class="social-muted">Carregando partidas...</p></div></section>' +
      '<section id="socialNotifications" class="social-panel"' + (activeSocialPanel === 'notifications' ? '' : ' hidden') + '><div class="social-heading"><div><h3>Notificações</h3></div><button type="button" data-action="mark-read">Marcar como lidas</button></div><div class="social-list" id="socialNotificationList"></div></section>';

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
      if (button.dataset.action === 'mark-read') {
        api.markNotificationsRead().then(renderSocialProfile).catch(function (error) {
          console.error('Unable to mark social notifications as read', error);
          reportError(root, 'Não foi possível atualizar as notificações.');
        });
        return;
      }
      if (button.dataset.action === 'back-profile') {
        root.querySelector('#socialDetails').hidden = true;
        root.querySelector('#socialConnections').hidden = true;
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
        if (button.dataset.following === 'true' &&
          !window.confirm('Sair da arquibancada?')) return;
        api.follow(button.dataset.followId, button.dataset.following !== 'true')
          .then(renderSocialProfile)
          .catch(function (error) {
            console.error('Unable to update athlete follow', error);
            reportError(root, 'Não foi possível atualizar o acompanhamento. Tente novamente.');
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
      if (!query) return;
      var resultBox = root.querySelector('#socialSearchResults');
      resultBox.innerHTML = '<p class="social-muted">Buscando atletas...</p>';
      api.searchProfiles(query).then(function (data) {
        var people = rows(data).filter(function (person) {
          return person.public_id !== ownPublicId;
        });
        resultBox.innerHTML = people.length
          ? people.map(function (person) {
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
        console.error('Unable to search athlete profiles', error);
        resultBox.innerHTML = '<p class="social-error">Não foi possível buscar atletas. Verifique a conexão e tente novamente.</p>';
      });
    };

    api.getProfile(ownPublicId).then(function (data) {
      var profile = rows(data)[0];
      if (!profile) {
        reportError(root, 'Seu perfil social não foi encontrado. Confirme se a migração do Supabase foi aplicada.');
        return;
      }
      root.querySelector('#socialCraques').textContent = profile.craques_count;
      root.querySelector('#socialAudience').textContent = profile.arquibancada_count;
      root.querySelector('#socialGames').textContent = profile.games_count;
      var profileGames = document.getElementById('profileSocialGames');
      var profileCraques = document.getElementById('profileSocialCraques');
      var profileAudience = document.getElementById('profileSocialAudience');
      if (profileGames) profileGames.textContent = profile.games_count;
      if (profileCraques) profileCraques.textContent = profile.craques_count;
      if (profileAudience) profileAudience.textContent = profile.arquibancada_count;
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
        : '<p class="social-muted">Ainda não há partidas concluídas pelos seus Craques.</p>';
    }).catch(function (error) {
      console.error('Unable to load followed athletes activities', error);
      root.querySelector('#socialFeedList').innerHTML =
        '<p class="social-error">Não foi possível carregar os jogos da arquibancada.</p>';
    });

    api.notifications().then(function (data) {
      var notifications = rows(data);
      var unread = notifications.filter(function (item) { return !item.read_at; }).length;
      root.querySelector('#socialNotificationCount').textContent = unread ? '(' + unread + ')' : '';
      var list = root.querySelector('#socialNotificationList');
      list.innerHTML = notifications.length
        ? notifications.map(function (item) {
          var message = item.notification_type === 'follow'
            ? item.actor_name + ' entrou na sua arquibancada.'
            : item.notification_type === 'match_invitation'
            ? item.actor_name + ' convidou você para confirmar uma partida.'
            : item.actor_name + ' concluiu uma partida na sua arquibancada.';
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
      var list = root.querySelector('#socialConnections');
      list.hidden = false;
      list.innerHTML = '<p class="social-muted">Carregando atletas...</p>';
      api.listConnections(publicId, relation).then(function (data) {
        var people = rows(data);
        list.innerHTML = '<h3>' + (relation === 'craques' ? 'Meus Craques' : 'Minha Arquibancada') +
          '</h3>' + (people.length
            ? people.map(function (person) {
              return '<article class="social-person">' + avatar(person.photo_url, person.display_name) +
                '<div class="social-person-info"><b>' + esc(person.display_name) + '</b><small>' +
                esc(person.public_id) + (person.city ? ' · ' + esc(person.city) : '') +
                '</small></div><div class="social-person-actions"><button type="button" data-profile-id="' +
                esc(person.public_id) + '">Ver perfil</button>' +
                (person.public_id !== ownPublicId
                  ? followButton(person.public_id, person.followed_by_me === true)
                  : '') + '</div></article>';
            }).join('')
            : '<p class="social-muted">Ainda não há atletas nesta lista.</p>');
      }).catch(function (error) {
        console.error('Unable to load athlete connections', error);
        list.innerHTML = '<p class="social-error">Não foi possível carregar esta lista.</p>';
      });
    }

    function showProfile(publicId) {
      var details = root.querySelector('#socialDetails');
      details.hidden = false;
      details.innerHTML = '<p class="social-muted">Carregando perfil...</p>';
      api.getProfile(publicId).then(function (data) {
        var profile = rows(data)[0];
        if (!profile) {
          details.innerHTML = '<p class="social-muted">Este perfil não está disponível.</p>';
          return;
        }
        details.innerHTML = '<article class="social-profile-card"><div class="social-profile-top">' +
          avatar(profile.photo_url, profile.display_name) + '<div><h3>' +
          esc(profile.display_name) + '</h3><p>' + esc(profile.public_id) + ' · ' +
          esc(profile.city || 'Cidade não informada') + '</p><p>' +
          esc((profile.sports || []).join(', ') || 'Modalidade não informada') + '</p></div></div>' +
          '<div class="social-counts"><div class="social-count"><b>' +
          esc(profile.games_count) + '</b><span>Jogos</span></div><button class="social-count" data-connection-relation="craques" data-profile-id="' +
          esc(profile.public_id) + '"><b>' + esc(profile.craques_count) +
          '</b><span>Craques</span></button><button class="social-count" data-connection-relation="arquibancada" data-profile-id="' +
          esc(profile.public_id) + '"><b>' + esc(profile.arquibancada_count) +
          '</b><span>Arquibancada</span></button></div>' +
          '<div class="social-actions"><button type="button" data-action="back-profile">Voltar</button>' +
          (!profile.is_self ? followButton(profile.public_id, profile.is_following === true) : '') +
          '</div></article>';
      }).catch(function (error) {
        console.error('Unable to load public athlete profile', error);
        details.innerHTML = '<p class="social-error">Não foi possível abrir este perfil.</p>';
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
