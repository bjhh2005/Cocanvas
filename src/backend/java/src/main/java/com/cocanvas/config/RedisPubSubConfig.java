package com.cocanvas.config;

import com.cocanvas.pubsub.RedisRealtimeBroadcaster;
import com.cocanvas.pubsub.RedisRoomEventSubscriber;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.data.redis.connection.RedisConnectionFactory;
import org.springframework.data.redis.listener.ChannelTopic;
import org.springframework.data.redis.listener.RedisMessageListenerContainer;
import org.springframework.scheduling.annotation.EnableScheduling;

@Configuration
@EnableScheduling
@ConditionalOnProperty(name = "realtime.broadcaster", havingValue = "redis")
public class RedisPubSubConfig {

    @Bean
    public RedisMessageListenerContainer redisMessageListenerContainer(
            RedisConnectionFactory connectionFactory,
            RedisRoomEventSubscriber subscriber
    ) {
        RedisMessageListenerContainer container = new RedisMessageListenerContainer();
        container.setConnectionFactory(connectionFactory);
        for (int shard = 0; shard < RedisRealtimeBroadcaster.CHANNEL_SHARDS; shard += 1) {
            container.addMessageListener(
                    subscriber,
                    new ChannelTopic(RedisRealtimeBroadcaster.CHANNEL_PREFIX + shard)
            );
            container.addMessageListener(
                    subscriber,
                    new ChannelTopic(RedisRealtimeBroadcaster.TRANSIENT_CHANNEL_PREFIX + shard)
            );
        }
        return container;
    }
}
