"""
Restaura el realm `nutrismart` de Keycloak desde el export del repo y
siembra los usuarios de desarrollo con los UUID que la base ya espera.

El export (`infra/keycloak/realm-nutrismart.json`) trae realm, clientes,
roles y mappers, pero NUNCA usuarios: Keycloak no los exporta. Por eso los
usuarios se inyectan aqui, y con su `id` escrito a mano -- el import
completo SI respeta el id, y la API resuelve el profesional por
`keycloak_user_id = sub`. Si el id cambia, /api/profesional/yo devuelve 404
y el menu de administracion se apaga.
"""
import json
import pathlib
import urllib.error
import urllib.request

KC = 'http://localhost:8080'
REALM = 'nutrismart'
CLAVE = 'nutrismart-dev'
# Al lado de este script, no una ruta absoluta de una maquina concreta.
EXPORT = pathlib.Path(__file__).resolve().parent / 'realm-nutrismart.json'

TENANT_VIDA = '11111111-1111-1111-1111-111111111111'
TENANT_CONTROL = '99999999-9999-9999-9999-999999999999'


def usuario(uid, correo, nombre, apellido, roles, tenant):
    u = {
        'username': correo,
        'email': correo,
        'firstName': nombre,
        'lastName': apellido,
        'enabled': True,
        'emailVerified': True,
        'requiredActions': [],
        'credentials': [{'type': 'password', 'value': CLAVE, 'temporary': False}],
        'realmRoles': ['default-roles-' + REALM] + roles,
    }
    if uid:
        u['id'] = uid
    # El operador de plataforma NO lleva tenant_id: no pertenece a ninguna
    # clinica. Ponerle el UUID de una cualquiera haria que ese UUID acabara
    # usandose como filtro apuntando a una clinica que no es la suya.
    if tenant:
        u['attributes'] = {'tenant_id': [tenant]}
    return u


USUARIOS = [
    usuario('364f4a9b-8f08-4599-a848-68ade4fa48e0', 'ana@vida.cr',
            'Ana', 'Rodriguez', ['admin_clinica'], TENANT_VIDA),
    usuario('7c81373c-436e-4180-944e-19f74f0b10da', 'luis@vida.cr',
            'Luis', 'Peralta', ['nutricionista'], TENANT_VIDA),
    # Carlos no tiene keycloak_user_id en la base: se crea con id nuevo y
    # el script de despues lo escribe en la ficha.
    usuario(None, 'carlos@control.cr',
            'Carlos', 'Mendez', ['admin_clinica'], TENANT_CONTROL),
    usuario('abee20e8-d79b-433b-8b87-8ac97c983830', 'maria.fernandez@ejemplo.cr',
            'Maria', 'Fernandez', ['paciente'], TENANT_VIDA),
    usuario(None, 'operador@nutrismart.cr',
            'Operador', 'Plataforma', ['super_admin'], None),
]


def pedir(metodo, ruta, token=None, cuerpo=None):
    datos = json.dumps(cuerpo).encode() if cuerpo is not None else None
    req = urllib.request.Request(KC + ruta, data=datos, method=metodo)
    req.add_header('Content-Type', 'application/json')
    if token:
        req.add_header('Authorization', 'Bearer ' + token)
    try:
        with urllib.request.urlopen(req) as r:
            cuerpo_r = r.read().decode()
            return r.status, (json.loads(cuerpo_r) if cuerpo_r.strip() else None)
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode()


def token_master():
    cuerpo = 'grant_type=password&client_id=admin-cli&username=admin&password=admin'
    req = urllib.request.Request(
        KC + '/realms/master/protocol/openid-connect/token',
        data=cuerpo.encode(), method='POST')
    req.add_header('Content-Type', 'application/x-www-form-urlencoded')
    with urllib.request.urlopen(req) as r:
        return json.load(r)['access_token']


def main():
    t = token_master()
    print('token de master: ok')

    realm = json.loads(EXPORT.read_text(encoding='utf-8'))
    print('export leido: %d clientes, %d roles de realm'
          % (len(realm.get('clients', [])),
             len(realm.get('roles', {}).get('realm', []))))

    # Los usuarios del export son solo la cuenta de servicio; se conserva y
    # se le suman los de desarrollo.
    realm['users'] = realm.get('users', []) + USUARIOS

    # El realm vacio que hay ahora se borra para poder hacer un import
    # COMPLETO: es el unico que aplica de una vez la configuracion del
    # realm, los clientes, los roles y los mappers. Esta vacio (0 usuarios,
    # 0 clientes nutrismart-*), asi que no hay nada que perder, y el export
    # del repo es la fuente.
    code, _ = pedir('DELETE', '/admin/realms/' + REALM, t)
    print('borrado del realm vacio: HTTP %s' % code)

    code, resp = pedir('POST', '/admin/realms', t, realm)
    print('import del realm: HTTP %s %s' % (code, resp if code >= 300 else ''))
    if code >= 300:
        raise SystemExit('el import fallo; no se sigue')

    # Comprobacion: los usuarios, sus ids y sus roles.
    code, us = pedir('GET', '/admin/realms/%s/users?max=100' % REALM, t)
    print('\nusuarios en el realm: %d' % len(us))
    for u in sorted(us, key=lambda x: x['username']):
        code, rs = pedir(
            'GET', '/admin/realms/%s/users/%s/role-mappings/realm' % (REALM, u['id']), t)
        roles = sorted(r['name'] for r in rs) if isinstance(rs, list) else rs
        tenant = (u.get('attributes') or {}).get('tenant_id', ['(ninguno)'])
        print('  %-30s id=%s tenant=%s roles=%s'
              % (u['username'], u['id'], tenant[0], roles))

    # Y que el login funcione de verdad, no solo que el usuario exista.
    print('\n== login de prueba ==')
    for quien in ('ana@vida.cr', 'luis@vida.cr', 'operador@nutrismart.cr'):
        cuerpo = ('grant_type=password&client_id=nutrismart-web&username=%s&password=%s'
                  % (quien, CLAVE))
        req = urllib.request.Request(
            KC + '/realms/%s/protocol/openid-connect/token' % REALM,
            data=cuerpo.encode(), method='POST')
        req.add_header('Content-Type', 'application/x-www-form-urlencoded')
        try:
            with urllib.request.urlopen(req) as r:
                tok = json.load(r)['access_token']
            carga = json.loads(__import__('base64').urlsafe_b64decode(
                tok.split('.')[1] + '==').decode())
            print('  %-30s sub=%s tenant_id=%s roles=%s'
                  % (quien, carga['sub'], carga.get('tenant_id', '(ninguno)'),
                     sorted(carga.get('realm_access', {}).get('roles', []))))
        except urllib.error.HTTPError as e:
            print('  %-30s FALLA HTTP %s %s' % (quien, e.code, e.read().decode()[:200]))


main()
