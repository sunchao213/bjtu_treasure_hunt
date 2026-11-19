/// <summary>
/// R15 好友与聊天的 HTTP 接口：全部要求已登录会话，读写都只作用于会话所属 UID。
/// 路由统一挂在 /api/social 下，客户端只发送意图，未读数与关系状态由服务端计算。
/// </summary>
static class SocialApi
{
    sealed record ApplyRequest(string? TargetUid, string? RequestId);
    sealed record RespondRequest(string? PeerUid, string? Action);
    sealed record PeerRequest(string? PeerUid);
    sealed record BlockRequest(string? PeerUid, bool Blocked);
    sealed record SendRequest(string? PeerUid, string? Text, string? MessageId);
    sealed record ReadRequest(string? PeerUid, long Cursor);

    public static void Map(WebApplication app, LoginSessions sessions, FriendStore friends)
    {
        IResult WithSession(HttpContext context, Func<AccountUser, IResult> action)
        {
            var session = sessions.Find(context);
            return session is null ? Results.Unauthorized() : action(session.User);
        }

        static IResult Reply(FriendReply reply) => Results.Json(reply.Body, statusCode: reply.Status);

        app.MapGet("/api/social/roster", (HttpContext context) =>
            WithSession(context, user => Results.Ok(friends.Roster(user))));

        app.MapGet("/api/social/lookup", (HttpContext context, string? uid) =>
            WithSession(context, _ => Reply(friends.Lookup(uid))));

        app.MapPost("/api/social/apply", (HttpContext context, ApplyRequest input) =>
            WithSession(context, user => Reply(friends.Apply(user, input.TargetUid, input.RequestId))));

        app.MapPost("/api/social/respond", (HttpContext context, RespondRequest input) =>
            WithSession(context, user => Reply(friends.Respond(user, input.PeerUid, input.Action))));

        app.MapPost("/api/social/remove", (HttpContext context, PeerRequest input) =>
            WithSession(context, user => Reply(friends.Remove(user, input.PeerUid))));

        app.MapPost("/api/social/block", (HttpContext context, BlockRequest input) =>
            WithSession(context, user => Reply(friends.SetBlocked(user, input.PeerUid, input.Blocked))));

        app.MapGet("/api/social/messages", (HttpContext context, string? peer, long? after) =>
            WithSession(context, user => Reply(friends.Messages(user, peer, after ?? 0))));

        app.MapPost("/api/social/messages", (HttpContext context, SendRequest input) =>
            WithSession(context, user => Reply(friends.Send(user, input.PeerUid, input.Text, input.MessageId))));

        app.MapPost("/api/social/read", (HttpContext context, ReadRequest input) =>
            WithSession(context, user => Reply(friends.MarkRead(user, input.PeerUid, input.Cursor))));
    }
}
