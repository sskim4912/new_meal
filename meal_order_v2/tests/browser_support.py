import json

def mock_admin_auth(context):
    tokens=set()
    def handle(route):
        path=route.request.url.split('/auth/',1)[-1]
        body=route.request.post_data_json or {}
        token=route.request.headers.get('authorization','').removeprefix('Bearer ')
        if path=='login':
            if body.get('password')!='230880':
                route.fulfill(status=401,content_type='application/json',body=json.dumps({'error':'비밀번호를 확인해주세요.'}));return
            token='test-session-'+str(len(tokens)+1);tokens.add(token)
            result={'token':token,'expiresAt':4102444800000}
        elif path=='logout':tokens.discard(token);result={'ok':True}
        elif token in tokens:result={'ok':True}
        else:
            route.fulfill(status=401,content_type='application/json',body=json.dumps({'error':'관리자 로그인이 만료되었습니다.'}));return
        route.fulfill(content_type='application/json',body=json.dumps(result))
    context.route('**/auth/**',handle)
